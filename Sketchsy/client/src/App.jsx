import React from 'react';
import { GameProvider, useGame } from './GameContext.jsx';
import Home from './screens/Home.jsx';
import Lobby from './screens/Lobby.jsx';
import Game from './screens/Game.jsx';
import Toast from './components/Toast.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import './styles/game.css';

function Router() {
  const { room, you } = useGame();
  const inRoom = room && room.players?.some((p) => p.id === you);

  let screen;
  if (!inRoom) screen = <Home />;
  else if (room.phase === 'lobby') screen = <Lobby />;
  else screen = <Game />;

  return (
    <div className="app">
      {screen}
      <ThemeToggle />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Router />
    </GameProvider>
  );
}
