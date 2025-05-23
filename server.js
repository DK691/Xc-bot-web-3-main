const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files (your web UI, etc)
app.use(express.static(__dirname));

// CORS middleware (optional, keep if needed)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

wss.on('connection', (socket, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log(`✅ Client connected: ${clientIP}`);

  socket.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
      console.log(`📨 Received from client ${clientIP}:`, data);
    } catch (err) {
      console.error(`⚠️ Invalid JSON from client ${clientIP}:`, err.message);
      return;
    }

    // Broadcast received message to all other connected clients except sender
    wss.clients.forEach((client) => {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });

    // Here you handle commands sent from any client, and optionally
    // you can route or respond to them, e.g. send acknowledgments
    // or update internal server state if needed.
    // The ESP32-CAM is expected to be connected as a WebSocket client too,
    // receiving commands this way.

    // Example: just log commands, you can add custom logic here
    if (data.command) {
      console.log(`🔧 Command received: ${data.command}`, data);
      // For example, you could send a confirmation back:
      socket.send(JSON.stringify({ status: 'ok', receivedCommand: data.command }));
    }
  });

  socket.on('close', () => {
    console.log(`🔌 Client disconnected: ${clientIP}`);
  });

  socket.on('error', (err) => {
    console.error(`❌ WebSocket error from ${clientIP}:`, err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌐 Server running at http://localhost:${PORT}`);
  console.log(`🛰️ Use WebSocket clients to connect at ws://localhost:${PORT}`);
});
