# Timeless Chat (WhatsApp-Style Starter)

This project gives you a WhatsApp-like one-to-one chat app with:

- Register and login
- User profile info (`display name`, `about`)
- Contact list
- Realtime private chat
- Image and video messages

## Tech Stack

- Backend: Node.js, Express, Socket.IO, SQLite
- Frontend: HTML, CSS, vanilla JavaScript
- Auth: JWT + password hashing (`bcryptjs`)

## 1. Install Node.js

If you do not already have Node.js:

1. Download and install from [https://nodejs.org](https://nodejs.org)
2. Verify:

```bash
node -v
npm -v
```

## 2. Install Dependencies

In this project folder:

```bash
npm install
```

## 3. Run the App

```bash
npm start
```

Open:

- [http://localhost:3000](http://localhost:3000)

## 4. Test with Two Users

1. Open one browser window and register user A
2. Open another browser window (or incognito) and register user B
3. Select each other in the contacts list
4. Send text, images, and videos

## Environment (Optional)

You can set:

- `PORT` (default `3000`)
- `JWT_SECRET` (recommended for production)

Example (PowerShell):

```powershell
$env:JWT_SECRET="your-strong-secret"
npm start
```

## Project Structure

```text
.
|- public/
|  |- app.js
|  |- index.html
|  |- styles.css
|- server.js
|- package.json
|- chat.db (created automatically)
|- uploads/ (created automatically)
```

## Notes

- This is a starter app for learning and building.
- For production, add stronger security, rate limiting, validation, backups, and cloud file storage.
