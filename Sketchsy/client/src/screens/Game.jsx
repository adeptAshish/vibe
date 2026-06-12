import React from 'react';
import { useGame } from '../GameContext.jsx';
import GameHeader from '../components/GameHeader.jsx';
import DrawingCanvas from '../components/DrawingCanvas.jsx';
import Chat from '../components/Chat.jsx';
import PlayerList from '../components/PlayerList.jsx';
import Overlays from '../components/Overlays.jsx';

export default function Game() {
  const { room, you } = useGame();
  const isDrawer = room.currentDrawerId === you;
  const me = room.players.find((p) => p.id === you);
  const canGuess = !isDrawer && room.phase === 'drawing' && !me?.guessed;

  return (
    <div className="game">
      <GameHeader />
      <div className="game-body">
        <PlayerList />
        <DrawingCanvas canDraw={isDrawer && room.phase === 'drawing'} />
        <Chat canGuess={canGuess} />
      </div>
      <Overlays />
    </div>
  );
}
