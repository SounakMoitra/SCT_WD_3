import React, { useState } from "react";

const CircleSvg = ({ className = "w-12 h-12 text-blue-400" }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

const CrossSvg = ({ className = "w-12 h-12 text-red-400" }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className}>
    <path
      d="M18 6L6 18M6 6l12 12"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Square = ({
  gameState,
  setGameState,
  playingAs,
  currentElement,
  finishedArrayState,
  finishedState,
  id,
  currentPlayer,
  setCurrentPlayer,
  sendMessage,
}) => {
  const clickOnSquare = () => {
    // Prevent moves if it's not the player's turn
    if (playingAs !== currentPlayer) {
      return;
    }

    // Prevent moves if game is finished
    if (finishedState) {
      return;
    }

    // Prevent moves if square is already filled
    if (currentElement === "circle" || currentElement === "cross") {
      return;
    }

    // Send move to server - server will handle all game state updates
    sendMessage("playerMoveFromClient", {
      id,
      sign: currentPlayer,
    });
  };

  // Determine square styling
  const getSquareClasses = () => {
    let classes = "w-20 h-20 bg-white/10 backdrop-blur-md rounded-lg flex items-center justify-center transition-all duration-300 border-2 border-transparent ";

    // Add hover effect if clickable
    if (!finishedState && playingAs === currentPlayer && currentElement !== "circle" && currentElement !== "cross") {
      classes += "hover:bg-white/20 hover:border-white/30 cursor-pointer hover:scale-105 ";
    } else {
      classes += "cursor-not-allowed ";
    }

    // Add winning highlight
    if (finishedArrayState.includes(id)) {
      if (finishedState === "circle") {
        classes += "bg-blue-500/30 border-blue-400 ring-2 ring-blue-400 ";
      } else if (finishedState === "cross") {
        classes += "bg-red-500/30 border-red-400 ring-2 ring-red-400 ";
      }
    }

    // Add disabled styling for finished game
    if (finishedState && !finishedArrayState.includes(id)) {
      classes += "opacity-60 ";
    }

    // Add disabled styling when it's not player's turn
    if (currentPlayer !== playingAs && !finishedState) {
      classes += "opacity-70 ";
    }

    return classes;
  };

  // Render the appropriate icon
  const renderIcon = () => {
    if (currentElement === "circle") {
      return <CircleSvg />;
    } else if (currentElement === "cross") {
      return <CrossSvg />;
    }
    return null; // Empty square
  };

  return (
    <div
      onClick={clickOnSquare}
      className={getSquareClasses()}
    >
      {renderIcon()}
    </div>
  );
};

export default Square;