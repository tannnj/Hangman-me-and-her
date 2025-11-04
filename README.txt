
# Hangman Online (FBG-style clone)

Two-player online Hangman with:
- Lobby + ready-up
- Simultaneous word + hint entry (Word max 16, Hint max 120)
- Turn A then turn B; the non-active player spectates
- 6 mistakes allowed; wrong letters turn red, correct letters cyan
- On success: "Your guess was CORRECT.\nYour score is 20 points." and NEXT button
- After both rounds finish, a simple scoreboard is shown

## Run locally

1) Make sure you have Node.js installed.
2) In a terminal:
```
cd hangman-online
npm install
npm start
```
3) Open two browser tabs to http://localhost:3000 and join the same room code with different names.

## Notes

- State is in-memory, suitable for demos and LAN. For production, persist rooms and add reconnect logic.
- You can edit colors and fonts in `public/style.css`.
