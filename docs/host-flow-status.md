# Host Flow Status

## Host Identity

The host is the person who clicks **Create Room**.

When the room is created, the server stores that browser's existing `sessionId`
as `rooms.host_session_id`. There is no password, caller key, unlock form, or
separate host secret. Host access is checked by comparing the current browser's
`sessionId` with the `host_session_id` saved when the room was created.

## Lobby Flow

### Player

1. Enter a room code and name.
2. Click **Join Room**.
3. Land directly in the game view.

### Host

1. Enter a name, optionally.
2. Click **Create Room**.
3. The room is created.
4. The host is auto-joined as a player.
5. The host lands directly in the game view with caller controls visible.

There is no caller key input and no unlock step.

## Game View

### Regular Player

Regular players see:

- Their bingo board
- Called numbers sidebar
- Reset Board button

The black caller section at the bottom is hidden by the client.

### Host

The host sees everything a regular player sees, plus the caller section. The host
also has a bingo board because room creation auto-joins them as a player.

The caller section is shown automatically when `roomState.hostPlayerId` matches
the current player's `playerId`.

Host controls include:

- Start Game / Stop Game button
- Winners list
- Transfer Host dropdown
- Reset Game button
- Roll Number button

The host triggers each roll, but the server chooses the number from the
remaining uncalled numbers. The roll animation is broadcast to every player so
the draw is visible to the whole room.

## Host Transfer Flow

1. The current host opens the **Transfer Host** dropdown in the caller section.
2. The dropdown is populated with all other players in the room.
3. The host selects a player.
4. The host clicks **Hand Off**.
5. The host confirms the transfer.
6. The server updates `rooms.host_session_id` to the selected player's
   `sessionId`.
7. The server broadcasts the updated room state to all connected clients.
8. The new host's client sees that `hostPlayerId` now matches its own `playerId`,
   so the caller section appears automatically.
9. The old host's client sees that `hostPlayerId` no longer matches its
   `playerId`, so the caller section disappears automatically.

## Page Reload And Reconnect

On page load, `restoreRoom()` runs and calls `joinRoom` with the stored
`sessionId`.

The response includes `hostPlayerId`. If that value matches the restored
player's `playerId`, caller controls appear automatically. The host does not need
to re-enter any key.

## Test Checklist

- Create a room and confirm the creator sees the caller panel.
- Join the same room in another tab and confirm that player does not see the
  caller panel.
- Start the game and confirm the board locks for all players.
- Roll a number and confirm the roll animation and final called number appear
  for all players.
- Transfer host to the other tab's player and confirm the caller panels swap.
- Refresh the host's page and confirm caller controls return automatically.
