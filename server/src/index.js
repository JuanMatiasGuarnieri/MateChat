import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'matechat-secret-key-2024';

// Check database connection
prisma.$on('error', (e) => {
  console.error('Prisma error:', e);
});

(async () => {
  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Database connection error:', error.message);
  }
})();

app.use(cors());
app.use(express.json());

// Health check endpoint that creates tables if needed
app.get('/api/health', async (req, res) => {
  try {
    // Try to query the database
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    // Try to create tables
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS User (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS Room (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS Message (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          userId INTEGER NOT NULL,
          roomId INTEGER NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES User(id),
          FOREIGN KEY (roomId) REFERENCES Room(id)
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS UserRoom (
          userId INTEGER NOT NULL,
          roomId INTEGER NOT NULL,
          joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (userId, roomId),
          FOREIGN KEY (userId) REFERENCES User(id),
          FOREIGN KEY (roomId) REFERENCES Room(id)
        )
      `);
      res.json({ status: 'ok', database: 'created' });
    } catch (createError) {
      res.status(500).json({ status: 'error', database: createError.message });
    }
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};

app.post('/api/register', async (req, res) => {
  console.log('Register request received');
  try {
    const { username, password } = req.body;
    console.log('Username:', username);
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const existingUser = await prisma.user.findUnique({ where: { username } });
    console.log('Existing user check:', existingUser);
    if (existingUser) {
      return res.status(400).json({ error: 'El usuario ya existe' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Creating user...');
    const user = await prisma.user.create({
      data: { username, password: hashedPassword }
    });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/rooms', authenticateToken, async (req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      include: {
        users: {
          include: { user: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(rooms.map(room => ({
      id: room.id,
      name: room.name,
      userCount: room.users.length,
      users: room.users.map(u => u.user.username)
    })));
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener salas' });
  }
});

app.post('/api/rooms', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Nombre de sala requerido' });
    }

    const room = await prisma.room.create({
      data: { name }
    });

    await prisma.userRoom.create({
      data: { userId: req.user.id, roomId: room.id }
    });

    res.json({ id: room.id, name: room.name, userCount: 1, users: [req.user.username] });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear sala' });
  }
});

app.post('/api/rooms/:id/join', authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const userId = req.user.id;

    const existing = await prisma.userRoom.findUnique({
      where: { userId_roomId: { userId, roomId } }
    });

    if (!existing) {
      await prisma.userRoom.create({
        data: { userId, roomId }
      });
    }

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { users: { include: { user: true } } }
    });

    res.json({
      id: room.id,
      name: room.name,
      userCount: room.users.length,
      users: room.users.map(u => ({ id: u.user.id, username: u.user.username }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al unirse a la sala' });
  }
});

app.post('/api/rooms/:id/leave', authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const userId = req.user.id;

    await prisma.userRoom.delete({
      where: { userId_roomId: { userId, roomId } }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al salir de la sala' });
  }
});

app.get('/api/rooms/:id/messages', authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const messages = await prisma.message.findMany({
      where: { roomId },
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100
    });
    res.json(messages.map(m => ({
      id: m.id,
      content: m.content,
      username: m.user.username,
      createdAt: m.createdAt
    })));
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

app.post('/api/rooms/:id/messages', authenticateToken, async (req, res) => {
  try {
    const roomId = parseInt(req.params.id);
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: 'Contenido requerido' });
    }

    const message = await prisma.message.create({
      data: { content, userId: req.user.id, roomId },
      include: { user: { select: { username: true } } }
    });

    io.to(`room-${roomId}`).emit('new_message', {
      id: message.id,
      content: message.content,
      username: message.user.username,
      createdAt: message.createdAt
    });

    res.json({
      id: message.id,
      content: message.content,
      username: message.user.username,
      createdAt: message.createdAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('Usuario conectado:', socket.id);

  socket.on('join_room', ({ roomId, username, userId }) => {
    socket.join(`room-${roomId}`);
    rooms.set(socket.id, { roomId, username, userId });

    socket.to(`room-${roomId}`).emit('user_joined', { username, userId, socketId: socket.id });
    io.to(`room-${roomId}`).emit('room_users', getRoomUsers(roomId));
  });

  socket.on('leave_room', ({ roomId }) => {
    const roomData = rooms.get(socket.id);
    if (roomData) {
      socket.to(`room-${roomId}`).emit('user_left', { username: roomData.username, userId: roomData.userId });
      rooms.delete(socket.id);
      io.to(`room-${roomId}`).emit('room_users', getRoomUsers(roomId));
    }
    socket.leave(`room-${roomId}`);
  });

  socket.on('voice_offer', ({ roomId, targetSocketId, offer, username }) => {
    io.to(targetSocketId).emit('voice_offer', {
      offer,
      username,
      fromSocketId: socket.id
    });
  });

  socket.on('voice_answer', ({ roomId, targetSocketId, answer }) => {
    io.to(targetSocketId).emit('voice_answer', {
      answer,
      fromSocketId: socket.id
    });
  });

  socket.on('ice_candidate', ({ roomId, targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('ice_candidate', {
      candidate,
      fromSocketId: socket.id
    });
  });

  socket.on('disconnect', () => {
    const roomData = rooms.get(socket.id);
    if (roomData) {
      const { roomId } = roomData;
      socket.to(`room-${roomId}`).emit('user_left', { username: roomData.username, userId: roomData.userId });
      io.to(`room-${roomId}`).emit('room_users', getRoomUsers(roomId));
      rooms.delete(socket.id);
    }
    console.log('Usuario desconectado:', socket.id);
  });
});

function getRoomUsers(roomId) {
  const users = [];
  rooms.forEach((data, socketId) => {
    if (data.roomId === roomId) {
      users.push({ socketId, username: data.username, userId: data.userId });
    }
  });
  return users;
}

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Serve static files in production (but NOT for /api/* routes)
if (NODE_ENV === 'production') {
  let clientPath = path.join(__dirname, '../client/dist');

  if (!fs.existsSync(clientPath)) {
    clientPath = path.join(__dirname, '../../client/dist');
  }
  if (!fs.existsSync(clientPath)) {
    clientPath = path.join(__dirname, '../../../client/dist');
  }

  console.log('Serving static files from:', clientPath);
  console.log('Path exists:', fs.existsSync(clientPath));

  // Serve static files only for known extensions
  app.use(express.static(clientPath, {
    index: false,
    dotfiles: 'ignore',
    extensions: ['html', 'js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webmanifest', 'woff', 'woff2']
  }));

  // Only serve index.html for routes that don't start with /api
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientPath, 'index.html'));
    } else {
      next();
    }
  });
}

httpServer.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT} (${NODE_ENV})`);
});