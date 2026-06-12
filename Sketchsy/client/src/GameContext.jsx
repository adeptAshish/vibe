import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { socket, emit } from './socket.js';

const GameContext = createContext(null);
export const useGame = () => useContext(GameContext);

export function GameProvider({ children }) {
  const [connected, setConnected] = useState(socket.connected);
  const [you, setYou] = useState(null);
  const [room, setRoom] = useState(null);
  const [meta, setMeta] = useState({ genres: [], difficulties: [] });

  const [wordChoices, setWordChoices] = useState(null);
  const [yourWord, setYourWord] = useState(null);
  const [turnBanner, setTurnBanner] = useState(null); // { drawerName, round }
  const [turnEnd, setTurnEnd] = useState(null);
  const [gameEnd, setGameEnd] = useState(null);
  const [chat, setChat] = useState([]);
  const [toast, setToast] = useState(null);

  // Drawing event subscribers (the canvas registers here).
  const drawListeners = useRef(new Set());
  const onDrawEvent = useCallback((fn) => {
    drawListeners.current.add(fn);
    return () => drawListeners.current.delete(fn);
  }, []);
  const fireDraw = (type, payload) => {
    drawListeners.current.forEach((fn) => fn(type, payload));
  };

  useEffect(() => {
    fetch('/api/genres')
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setYou(socket.id);
    };
    const onDisconnect = () => setConnected(false);

    const onState = (s) => setRoom(s);

    const onTurnStart = (data) => {
      setWordChoices(null);
      setYourWord(null);
      setTurnEnd(null);
      setGameEnd(null);
      setTurnBanner({ drawerName: data.drawerName, round: data.round, totalRounds: data.totalRounds });
      fireDraw('clear');
    };
    const onWordChoices = (data) => setWordChoices(data.choices);
    const onTurnBegin = () => {
      setWordChoices(null);
      setTurnBanner(null);
    };
    const onYourWord = (data) => setYourWord(data.word);
    const onChat = (msg) => setChat((c) => [...c.slice(-120), { ...msg, key: Math.random().toString(36).slice(2) }]);
    const onTurnEnd = (data) => {
      setTurnEnd(data);
      setYourWord(null);
      setWordChoices(null);
    };
    const onGameEnd = (data) => {
      setGameEnd(data);
      setTurnEnd(null);
    };

    const onDrawStroke = (stroke) => fireDraw('stroke', stroke);
    const onDrawClear = () => fireDraw('clear');
    const onDrawInit = (data) => fireDraw('init', data.strokes);
    const onDrawReplace = (data) => fireDraw('replace', data.strokes);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onState);
    socket.on('game:turnStart', onTurnStart);
    socket.on('game:wordChoices', onWordChoices);
    socket.on('game:turnBegin', onTurnBegin);
    socket.on('game:yourWord', onYourWord);
    socket.on('game:hint', (d) => setRoom((r) => (r ? { ...r, maskedWord: d.maskedWord } : r)));
    socket.on('chat:message', onChat);
    socket.on('game:turnEnd', onTurnEnd);
    socket.on('game:end', onGameEnd);
    socket.on('draw:stroke', onDrawStroke);
    socket.on('draw:clear', onDrawClear);
    socket.on('draw:init', onDrawInit);
    socket.on('draw:replace', onDrawReplace);

    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onState);
      socket.off('game:turnStart', onTurnStart);
      socket.off('game:wordChoices', onWordChoices);
      socket.off('game:turnBegin', onTurnBegin);
      socket.off('game:yourWord', onYourWord);
      socket.off('chat:message', onChat);
      socket.off('game:turnEnd', onTurnEnd);
      socket.off('game:end', onGameEnd);
      socket.off('draw:stroke', onDrawStroke);
      socket.off('draw:clear', onDrawClear);
      socket.off('draw:init', onDrawInit);
      socket.off('draw:replace', onDrawReplace);
    };
  }, []);

  const flashToast = useCallback((text) => {
    setToast({ text, key: Math.random() });
    setTimeout(() => setToast(null), 2600);
  }, []);

  // ---- actions -------------------------------------------------------------
  const actions = {
    createRoom: async (name, avatar, settings) => {
      const res = await emit('room:create', { name, avatar, settings });
      if (res?.you) setYou(res.you);
      return res;
    },
    joinRoom: async (code, name, avatar) => {
      const res = await emit('room:join', { code, name, avatar });
      if (res?.you) setYou(res.you);
      if (res?.error) flashToast(res.error);
      return res;
    },
    updateSettings: (settings) => socket.emit('room:updateSettings', settings),
    addCustomList: (list) => emit('room:addCustomList', list),
    setPreferredGenre: (genre) => socket.emit('player:setGenre', { genre }),
    updateAvatar: (avatar) => socket.emit('player:updateAvatar', { avatar }),
    startGame: async () => {
      const res = await emit('game:start');
      if (res?.error) flashToast(res.error);
      return res;
    },
    chooseWord: (word) => socket.emit('game:chooseWord', { word }),
    sendGuess: (text) => socket.emit('chat:guess', { text }),
    returnToLobby: () => socket.emit('game:returnToLobby'),
    leaveRoom: async () => {
      await emit('room:leave');
      setRoom(null);
      setChat([]);
      setTurnEnd(null);
      setGameEnd(null);
      setWordChoices(null);
      setYourWord(null);
    },
    // drawing
    sendStroke: (stroke) => socket.emit('draw:stroke', stroke),
    clearCanvas: () => socket.emit('draw:clear'),
    undo: () => socket.emit('draw:undo'),
    resetLocal: () => {
      setRoom(null);
      setChat([]);
      setTurnEnd(null);
      setGameEnd(null);
    },
  };

  const value = {
    connected,
    you,
    room,
    meta,
    wordChoices,
    yourWord,
    turnBanner,
    turnEnd,
    gameEnd,
    chat,
    toast,
    onDrawEvent,
    flashToast,
    ...actions,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
