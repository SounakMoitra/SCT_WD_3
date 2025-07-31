# main.py
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
        self.player_name: Optional[str] = None

class Room:
    def __init__(self, player1: User, player2: User):
        self.player1 = player1
        self.player2 = player2
        player1.playing = True
        player2.playing = True

class GameMessage(BaseModel):
    type: str
    data: dict = {}


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
    
    # Generate user ID 
    # (here I amm using websocket object's id as unique identifier)
    user_id = str(id(websocket))
    
    # Create user and add to all_users
    current_user = User(websocket, user_id)
    all_users[user_id] = current_user
    
    try:
        while True:
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
    
    # Find opponent 
    opponent_player = None
    
    for user_id, user in all_users.items():
        if (user.online and 
            not user.playing and 
            user_id != current_user.user_id and
            user.player_name is not None):
            opponent_player = user
            break
    
    if opponent_player:
        # this will create a room for the two players
        room = Room(opponent_player, current_user)
        all_rooms.append(room)
        
        # Notify both players
        await manager.send_message(
            current_user.websocket,
            "OpponentFound",
            {
                "opponentName": opponent_player.player_name,
                "playingAs": "circle"
            }
        )
        
        await manager.send_message(
            opponent_player.websocket,
            "OpponentFound",
            {
                "opponentName": current_user.player_name,
                "playingAs": "cross"
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
    
    if opponent:
        await manager.send_message(
            opponent.websocket,
            "playerMoveFromServer",
            data
        )

async def handle_play_again(current_user: User):
    """Handle play again request - reset user state and find new opponent"""
    # Reset current user state
    current_user.playing = False
    current_user.player_name = None
    
    # Remove any existing rooms with this user
    rooms_to_remove = []
    for room in all_rooms:
        if room.player1.user_id == current_user.user_id or room.player2.user_id == current_user.user_id:
            rooms_to_remove.append(room)
            # Reset opponent's playing state too
            if room.player1.user_id == current_user.user_id:
                room.player2.playing = False
            else:
                room.player1.playing = False
    
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
            rooms_to_remove.append(room)
    
    # Remove rooms
    for room in rooms_to_remove:
        if room in all_rooms:
            all_rooms.remove(room)
    
    # Remove user from all_users
    if current_user.user_id in all_users:
        del all_users[current_user.user_id]

# Health check endpoint
@app.get("/")
async def root():
    return {"message": "Game Server is running", "active_users": len(all_users)}

@app.get("/stats")
async def get_stats():
    return {
        "active_users": len(all_users),
        "active_rooms": len(all_rooms),
        "users_online": len([u for u in all_users.values() if u.online]),
        "users_playing": len([u for u in all_users.values() if u.playing])
    }



if __name__ == "__main__":
    port = int(os.getenv("PORT", 3000))
    
    uvicorn.run(app, host="0.0.0.0", port=port)