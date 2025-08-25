
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
  };
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end(`Sorry, check with the site admin for error: ${err.code} ..\n`);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocket.Server({ server });

const rooms = {};

wss.on('connection', ws => {

  let roomId = null;
  let userId = null;

  ws.on('message', message => {
    const { type, payload } = JSON.parse(message);

    switch (type) {
      case 'join':
        roomId = payload.roomId;
        userId = payload.userId;
        if (!rooms[roomId]) {
          rooms[roomId] = {};
        }
        // Notify existing users
        for (const [id, client] of Object.entries(rooms[roomId])) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'user-joined', payload: { userId } }));
          }
        }
        rooms[roomId][userId] = ws;
        console.log(`User ${userId} joined room ${roomId}`);
        break;
      
      // WebRTC signaling messages
      case 'offer':
      case 'answer':
      case 'candidate':
        const targetId = payload.targetId;
        if (rooms[roomId] && rooms[roomId][targetId]) {
          rooms[roomId][targetId].send(JSON.stringify({ type, payload }));
        }
        break;
    }
  });

  ws.on('close', () => {
    if (roomId && userId && rooms[roomId]) {
      delete rooms[roomId][userId];
      // Notify remaining users
      for (const [id, client] of Object.entries(rooms[roomId])) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'user-left', payload: { userId } }));
        }
      }
      console.log(`User ${userId} left room ${roomId}`);
    }
  });
});

server.listen(8080, () => {
  console.log('Server running at http://localhost:8080');
});
