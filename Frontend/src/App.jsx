import React, { useState, useEffect, useRef } from "react";
import Square from "./Square/Square";
import Swal from "sweetalert2";

const renderFrom = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];

const App = () => {
  const [gameState, setGameState] = useState(renderFrom);
  const [currentPlayer, setCurrentPlayer] = useState("circle");
  const [finishedState, setFinishedState] = useState(false);
  const [finishedArrayState, setFinishedArrayState] = useState([]);
  const [playOnline, setPlayOnline] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [opponentName, setOpponentName] = useState(null);
  const [playingAs, setPlayingAs] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  
  const wsRef = useRef(null);

  const checkWinner = () => {
    // Row check
    for (let row = 0; row < gameState.length; row++) {
      if (
        gameState[row][0] === gameState[row][1] &&
        gameState[row][1] === gameState[row][2] &&
        (gameState[row][0] === "circle" || gameState[row][0] === "cross")
      ) {
        setFinishedArrayState([row * 3 + 0, row * 3 + 1, row * 3 + 2]);
        return gameState[row][0];
      }
    }

    // Column check
    for (let col = 0; col < gameState.length; col++) {
      if (
        gameState[0][col] === gameState[1][col] &&
        gameState[1][col] === gameState[2][col] &&
        (gameState[0][col] === "circle" || gameState[0][col] === "cross")
      ) {
        setFinishedArrayState([0 * 3 + col, 1 * 3 + col, 2 * 3 + col]);
        return gameState[0][col];
      }
    }

    // Diagonal checks
    if (
      gameState[0][0] === gameState[1][1] &&
      gameState[1][1] === gameState[2][2] &&
      (gameState[0][0] === "circle" || gameState[0][0] === "cross")
    ) {
      setFinishedArrayState([0, 4, 8]);
      return gameState[0][0];
    }

    if (
      gameState[0][2] === gameState[1][1] &&
      gameState[1][1] === gameState[2][0] &&
      (gameState[0][2] === "circle" || gameState[0][2] === "cross")
    ) {
      setFinishedArrayState([2, 4, 6]);
      return gameState[0][2];
    }

    // Draw check
    const isDrawMatch = gameState.flat().every((e) => {
      return e === "circle" || e === "cross";
    });

    if (isDrawMatch) return "draw";

    return null;
  };

  /**
   * local checkWinner useEffect is not reqd.
   * 
   * the backend server handles this now.....
   */
  
  // useEffect(() => {
  //   const winner = checkWinner();
  //   if (winner) {
  //     setFinishedState(winner);
  //     // Notify server that game has ended
  //     sendMessage("gameEnded", {});
  //   }
  // }, [gameState]);


  const takePlayerName = async () => {
    const result = await Swal.fire({
      title: "Enter your name",
      input: "text",
      showCancelButton: true,
      confirmButtonColor: "#3b82f6",
      cancelButtonColor: "#ef4444",
      background: "#1f2937",
      color: "#ffffff",
      inputValidator: (value) => {
        if (!value) {
          return "You need to write something!";
        }
      },
    });

    return result;
  };

  const connectWebSocket = () => {
    const wsUrl = import.meta.env.VITE_BACKEND_URL || "ws://localhost:3000/ws";
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("Connected to WebSocket");
      setConnectionStatus("connected");
      setPlayOnline(true);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("Received message:", message);

      switch (message.type) {
        case "OpponentFound":
          setPlayingAs(message.data.playingAs);
          setOpponentName(message.data.opponentName);

          // Use server's fresh game state
          setGameState(message.data.gameState);
          setCurrentPlayer(message.data.currentPlayer);
          setFinishedState(false);
          setFinishedArrayState([]);
          break;

        case "OpponentNotFound":
          setOpponentName(false);
          break;

        case "playerMoveFromServer":
          // Update game state from server
          setGameState(message.data.gameState);
          setCurrentPlayer(message.data.currentPlayer);
          if (message.data.finished) {
            setFinishedState(message.data.winner);
          }
          break;

        case "moveConfirmed":
          // Confirm our own move with server state
          setGameState(message.data.gameState);
          setCurrentPlayer(message.data.currentPlayer);
          if (message.data.finished) {
            setFinishedState(message.data.winner);
          }
          break;

        case "opponentLeftMatch":
          setFinishedState("opponentLeftMatch");
          break;

        case "gameReset":
          // Reset game state when server sends reset signal
          resetGameState();
          break;

        case "gameEndedWaitingForAction":
          // Game ended, players are now inactive until they choose an action
          console.log("Game ended, waiting for player action");
          break;

        default:
          console.log("Unknown message type:", message.type);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket connection closed");
      setConnectionStatus("disconnected");
      setPlayOnline(false);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setConnectionStatus("error");
    };

    return ws;
  };

  const sendMessage = (type, data = {}) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  };

  const playOnlineClick = async () => {
    const result = await takePlayerName();

    if (!result.isConfirmed) {
      return;
    }

    const username = result.value;
    setPlayerName(username);

    // Connect to WebSocket
    wsRef.current = connectWebSocket();

    // Wait for connection, then send request to play
    wsRef.current.onopen = () => {
      setConnectionStatus("connected");
      setPlayOnline(true);
      sendMessage("request_to_play", { playerName: username });
    };
  };

  const resetGameState = () => {
    setGameState(renderFrom);
    setCurrentPlayer("circle");
    setFinishedState(false);
    setFinishedArrayState([]);
    setOpponentName(null);
    setPlayingAs(null);
  };

  const resetGame = () => {
    resetGameState();
    setPlayOnline(false);
    setPlayerName("");
    setConnectionStatus("disconnected");
    
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  const playAgain = async () => {
    const result = await takePlayerName();

    if (!result.isConfirmed) {
      return;
    }

    const username = result.value;
    setPlayerName(username);
    
    // Reset game state first
    resetGameState();
    
    // Sending play again request to server 
    // this will make the user available for matching for the next game
    sendMessage("playAgain", {});
    
    // now, request to play with new name
    setTimeout(() => {
      sendMessage("request_to_play", { playerName: username });
    }, 100);
  };

  // Cleanup WebSocket on component unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  if (!playOnline) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-white mb-8 animate-pulse">
            Tic Tac Toe
          </h1>
          <div className="space-y-4">
            <button
              onClick={playOnlineClick}
              className="bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white font-bold py-4 px-8 rounded-lg text-xl transition-all duration-300 transform hover:scale-105 shadow-lg border border-gray-600"
            >
              Play Online
            </button>
            <p className="text-gray-300 text-sm">
              Status: <span className="font-semibold">{connectionStatus}</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (playOnline && !opponentName) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-white border-t-transparent mx-auto mb-6"></div>
          <h2 className="text-3xl font-bold text-white mb-4">
            Waiting for opponent...
          </h2>
          <p className="text-gray-300">
            Player: <span className="font-semibold text-blue-400">{playerName}</span>
          </p>
          <button
            onClick={resetGame}
            className="mt-6 bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded transition-colors border border-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 py-8">
      <div className="container mx-auto px-4">
        {/* Player Info */}
        <div className="flex justify-between items-center mb-8 bg-white/10 backdrop-blur-md rounded-lg p-4">
          <div className={`flex items-center space-x-3 px-4 py-2 rounded-lg ${
            currentPlayer === playingAs ? 'bg-green-500/30 ring-2 ring-green-400' : 'bg-gray-500/20'
          }`}>
            <div className="w-6 h-6">
              {playingAs === "circle" ? (
                <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2"/>
                </svg>
              )}
            </div>
            <span className="text-white font-semibold">{playerName}</span>
          </div>
          
          <div className={`flex items-center space-x-3 px-4 py-2 rounded-lg ${
            currentPlayer !== playingAs ? 'bg-green-500/30 ring-2 ring-green-400' : 'bg-gray-500/20'
          }`}>
            <div className="w-6 h-6">
              {playingAs !== "circle" ? (
                <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2"/>
                </svg>
              )}
            </div>
            <span className="text-white font-semibold">{opponentName}</span>
          </div>
        </div>

        {/* Game Title */}
        <h1 className="text-5xl font-bold text-white text-center mb-8">
          Tic Tac Toe
        </h1>

        {/* Game Board */}
        <div className="flex justify-center mb-8">
          <div className="grid grid-cols-3 gap-2 bg-white/20 p-4 rounded-lg backdrop-blur-md">
            {gameState.map((arr, rowIndex) =>
              arr.map((e, colIndex) => (
                <Square
                  key={rowIndex * 3 + colIndex}
                  id={rowIndex * 3 + colIndex}
                  currentElement={e}
                  gameState={gameState}
                  setGameState={setGameState}
                  currentPlayer={currentPlayer}
                  setCurrentPlayer={setCurrentPlayer}
                  finishedState={finishedState}
                  finishedArrayState={finishedArrayState}
                  playingAs={playingAs}
                  sendMessage={sendMessage}
                />
              ))
            )}
          </div>
        </div>

        {/* Game Status */}
        <div className="text-center">
          {finishedState && finishedState !== "opponentLeftMatch" && finishedState !== "draw" && (
            <h3 className="text-2xl font-bold text-white mb-4">
              {finishedState === playingAs ? "🎉 You Won!" : `${finishedState.toUpperCase()} Won!`}
            </h3>
          )}
          
          {finishedState === "draw" && (
            <h3 className="text-2xl font-bold text-yellow-400 mb-4">
              🤝 It's a Draw!
            </h3>
          )}
          
          {finishedState === "opponentLeftMatch" && (
            <h3 className="text-2xl font-bold text-green-400 mb-4">
              🎉 You Won! Opponent Left the Match
            </h3>
          )}
          
          {!finishedState && opponentName && (
            <h2 className="text-xl text-white">
              Playing against <span className="font-bold text-blue-400">{opponentName}</span>
            </h2>
          )}

          {(finishedState || finishedState === "opponentLeftMatch") && (
            <div className="space-x-4">
              <button
                onClick={playAgain}
                className="mt-4 bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105 border border-gray-600"
              >
                Play Again
              </button>
              <button
                onClick={resetGame}
                className="mt-4 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-500 hover:to-gray-600 text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105 border border-gray-500"
              >
                Main Menu
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;