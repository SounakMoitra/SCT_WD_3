from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
from typing import Dict, List, Optional
import uvicorn
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Game Server", version="1.0.0")

# CORS middleware 
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CLIENT_ORIGIN_DEV", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

class User:
    def __init__(self, websocket: WebSocket, user_id: str):
        self.websocket = websocket
        self.user_id = user_id
        self.online = True
        self.playing = False
        self.active_for_matching = False  # New field to control matching availability
        self.player_name: Optional[str] = None

class Room:
    def __init__(self, player1: User, player2: User):
        self.player1 = player1
        self.player2 = player2
        
        # Initial new game state
        self.game_state = [
            [1, 2, 3],
            [4, 5, 6], 
            [7, 8, 9]
        ]

        self.current_player = "circle"
        self.finished = False
        self.winner = None
        player1.playing = True
        player2.playing = True
        player1.active_for_matching = False
        player2.active_for_matching = False

class GameMessage(BaseModel):
    type: str
    data: dict = {}

# Global storage (equivalent to your allUsers and allRooms)
all_users: Dict[str, User] = {}
all_rooms: List[Room] = []

class ConnectionManager:
    def __init__(self):
        pass
    
    async def send_message(self, websocket: WebSocket, message_type: str, data: dict = {}):
        """Send a message to a specific websocket"""
        message = {
            "type": message_type,
            "data": data
        }
        await websocket.send_text(json.dumps(message))
    
    async def broadcast_to_room(self, room: Room, message_type: str, data: dict = {}):
        """Send message to both players in a room"""
        await self.send_message(room.player1.websocket, message_type, data)
        await self.send_message(room.player2.websocket, message_type, data)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # Generate user ID (using websocket object's id as unique identifier)
    user_id = str(id(websocket))
    
    # Create user and add to all_users
    current_user = User(websocket, user_id)
    all_users[user_id] = current_user
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            message_type = message.get("type")
            message_data = message.get("data", {})
            
            if message_type == "request_to_play":
                await handle_request_to_play(current_user, message_data)
            
            elif message_type == "playerMoveFromClient":
                await handle_player_move(current_user, message_data)
            
            elif message_type == "playAgain":
                await handle_play_again(current_user)
                
    except WebSocketDisconnect:
        await handle_disconnect(current_user)

async def handle_request_to_play(current_user: User, data: dict):
    """Handle player requesting to play (equivalent to socket.on('request_to_play'))"""
    current_user.player_name = data.get("playerName")

    # Player is now available for matching
    current_user.active_for_matching = True  
    
    # Find opponent 
    opponent_player = None
    
    for user_id, user in all_users.items():
        if (user.online and 
            not user.playing and 
            user.active_for_matching and  # Only match with active players
            user_id != current_user.user_id and
            user.player_name is not None):
            opponent_player = user
            break
    
    if opponent_player:
        # Create room with fresh game state
        room = Room(opponent_player, current_user)
        all_rooms.append(room)
        
        # Notify both players with fresh game state
        await manager.send_message(
            current_user.websocket,
            "OpponentFound",
            {
                "opponentName": opponent_player.player_name,
                "playingAs": "circle",
                "gameState": room.game_state,
                "currentPlayer": room.current_player
            }
        )
        
        await manager.send_message(
            opponent_player.websocket,
            "OpponentFound",
            {
                "opponentName": current_user.player_name,
                "playingAs": "cross",
                "gameState": room.game_state,
                "currentPlayer": room.current_player
            }
        )
        
    else:
        await manager.send_message(
            current_user.websocket,
            "OpponentNotFound",
            {}
        )

async def handle_player_move(current_user: User, data: dict):
    """Handle player move and relay to opponent"""
    # Find the room this user is in
    current_room = None
    opponent = None
    
    for room in all_rooms:
        if room.player1.user_id == current_user.user_id:
            current_room = room
            opponent = room.player2
            break
        elif room.player2.user_id == current_user.user_id:
            current_room = room
            opponent = room.player1
            break
    
    if current_room and opponent and not current_room.finished:
        # Update server game state
        move_id = data.get("id")
        sign = data.get("sign")
        
        # Validate move
        row_index = move_id // 3
        col_index = move_id % 3
        
        if (current_room.game_state[row_index][col_index] != "circle" and 
            current_room.game_state[row_index][col_index] != "cross"):
            
            # Apply move to server state
            current_room.game_state[row_index][col_index] = sign
            current_room.current_player = "cross" if sign == "circle" else "circle"
            
            # Check for winner
            winner = check_winner_server(current_room.game_state)
            if winner:
                current_room.finished = True
                current_room.winner = winner
            
            # Send updated game state to both players
            game_update = {
                "id": move_id,
                "sign": sign,
                "gameState": current_room.game_state,
                "currentPlayer": current_room.current_player,
                "finished": current_room.finished,
                "winner": current_room.winner
            }
            
            await manager.send_message(
                opponent.websocket,
                "playerMoveFromServer",
                game_update
            )
            
            await manager.send_message(
                current_user.websocket,
                "moveConfirmed",
                game_update
            )

def check_winner_server(game_state):
    """Check winner on server side"""
    # Row check
    for row in range(3):
        if (game_state[row][0] == game_state[row][1] == game_state[row][2] and
            (game_state[row][0] == "circle" or game_state[row][0] == "cross")):
            return game_state[row][0]
    
    # Column check  
    for col in range(3):
        if (game_state[0][col] == game_state[1][col] == game_state[2][col] and
            (game_state[0][col] == "circle" or game_state[0][col] == "cross")):
            return game_state[0][col]
    
    # Diagonal checks
    if (game_state[0][0] == game_state[1][1] == game_state[2][2] and
        (game_state[0][0] == "circle" or game_state[0][0] == "cross")):
        return game_state[0][0]
        
    if (game_state[0][2] == game_state[1][1] == game_state[2][0] and
        (game_state[0][2] == "circle" or game_state[0][2] == "cross")):
        return game_state[0][2]
    
    # Draw check
    is_draw = all(
        cell == "circle" or cell == "cross" 
        for row in game_state 
        for cell in row
    )
    
    if is_draw:
        return "draw"
        
    return None

async def handle_play_again(current_user: User):
    """Handle play again request - reset user state and find new opponent"""
    # Reset current user state
    current_user.playing = False
    current_user.active_for_matching = True  # Make available for matching again
    old_player_name = current_user.player_name
    current_user.player_name = None
    
    # Remove any existing rooms with this user
    rooms_to_remove = []
    for room in all_rooms:
        if room.player1.user_id == current_user.user_id or room.player2.user_id == current_user.user_id:
            rooms_to_remove.append(room)
            # Reset opponent's playing state too
            if room.player1.user_id == current_user.user_id:
                room.player2.playing = False
                room.player2.active_for_matching = False
            else:
                room.player1.playing = False
                room.player1.active_for_matching = False
    
    for room in rooms_to_remove:
        if room in all_rooms:
            all_rooms.remove(room)
    
    # Send reset signal to client
    await manager.send_message(
        current_user.websocket,
        "gameReset",
        {}
    )

async def handle_disconnect(current_user: User):
    """Handle user disconnection"""
    current_user.online = False
    current_user.playing = False
    current_user.active_for_matching = False
    
    # Find opponent in any room and notify them
    rooms_to_remove = []
    for room in all_rooms:
        if room.player1.user_id == current_user.user_id:
            try:
                await manager.send_message(
                    room.player2.websocket,
                    "opponentLeftMatch",
                    {}
                )
            except:
                pass  # WebSocket might be closed
            room.player2.playing = False
            room.player2.active_for_matching = False
            rooms_to_remove.append(room)
            
        elif room.player2.user_id == current_user.user_id:
            try:
                await manager.send_message(
                    room.player1.websocket,
                    "opponentLeftMatch",
                    {}
                )
            except:
                pass  # WebSocket might be closed
            room.player1.playing = False
            room.player1.active_for_matching = False
            rooms_to_remove.append(room)
    
    # Remove rooms
    for room in rooms_to_remove:
        if room in all_rooms:
            all_rooms.remove(room)
    
    # Remove user from all_users
    if current_user.user_id in all_users:
        del all_users[current_user.user_id]

# Optional: Health check endpoint
@app.get("/")
async def root():
    return {"message": "Game Server is running", "active_users": len(all_users)}

@app.get("/stats")
async def get_stats():
    return {
        "active_users": len(all_users),
        "active_rooms": len(all_rooms),
        "users_online": len([u for u in all_users.values() if u.online]),
        "users_playing": len([u for u in all_users.values() if u.playing]),
        "users_available_for_matching": len([u for u in all_users.values() if u.active_for_matching])
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 3000))
    # Remove reload=True when running directly
    uvicorn.run(app, host="0.0.0.0", port=port)