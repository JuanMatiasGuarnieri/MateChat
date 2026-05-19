<template>
  <div class="min-h-screen flex flex-col">
    <div class="bg-gray-800 p-4 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">{{ currentRoom?.name }}</h1>
        <p class="text-sm text-gray-400">{{ roomUsers.length }} usuario{{ roomUsers.length !== 1 ? 's' : '' }} en voz</p>
      </div>
      <button @click="leaveRoom" class="bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg text-sm">
        Salir
      </button>
    </div>

    <div class="flex-1 flex flex-col md:flex-row overflow-hidden">
      <div class="flex-1 p-4 overflow-y-auto">
        <h2 class="text-lg font-semibold mb-4">Participantes</h2>

        <div class="space-y-3">
          <div
            v-for="user in roomUsers"
            :key="user.socketId"
            class="bg-gray-800 rounded-lg p-4 flex items-center gap-4"
          >
            <div
              class="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold"
              :class="user.userId === myUserId ? 'bg-mate-600' : 'bg-gray-600'"
            >
              {{ user.username.charAt(0).toUpperCase() }}
            </div>
            <div class="flex-1">
              <p class="font-medium">
                {{ user.username }}
                <span v-if="user.userId === myUserId" class="text-mate-500 text-sm">(tú)</span>
              </p>
              <p class="text-sm text-gray-400">
                {{ speakingUsers.has(user.socketId) ? '🎤 Hablando...' : 'Silencio' }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-400 text-sm">{{ userVolumes[user.socketId] || 100 }}%</span>
              <input
                type="range"
                min="0"
                max="200"
                :value="userVolumes[user.socketId] || 100"
                @input="(e) => setVolume(user.socketId, e.target.value)"
                class="w-20 accent-mate-500"
              />
            </div>
          </div>
        </div>

        <div v-if="roomUsers.length === 0" class="text-center py-8 text-gray-400">
          No hay nadie más en la sala
        </div>
      </div>

      <div class="w-full md:w-80 border-t md:border-l border-gray-700 flex flex-col">
        <div class="p-4 border-b border-gray-700">
          <h2 class="font-semibold">💬 Chat</h2>
        </div>

        <div ref="chatContainer" class="flex-1 overflow-y-auto p-4 space-y-3">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="bg-gray-800 rounded-lg p-3"
          >
            <p class="text-mate-500 text-sm font-medium">{{ msg.username }}</p>
            <p class="text-white">{{ msg.content }}</p>
            <p class="text-gray-500 text-xs mt-1">{{ formatTime(msg.createdAt) }}</p>
          </div>

          <div v-if="messages.length === 0" class="text-center text-gray-500 text-sm py-4">
            No hay mensajes aún
          </div>
        </div>

        <form @submit.prevent="sendMessage" class="p-4 border-t border-gray-700">
          <div class="flex gap-2">
            <input
              v-model="newMessage"
              type="text"
              placeholder="Escribir mensaje..."
              class="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-mate-500 text-white text-sm"
            />
            <button
              type="submit"
              :disabled="!newMessage.trim()"
              class="bg-mate-600 hover:bg-mate-500 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </form>
      </div>
    </div>

    <div class="p-4 bg-gray-800 border-t border-gray-700 flex items-center justify-center gap-4">
      <button
        @click="toggleMute"
        class="w-16 h-16 rounded-full flex items-center justify-center text-2xl transition-colors"
        :class="muted ? 'bg-red-600' : 'bg-mate-600 hover:bg-mate-500'"
      >
        {{ muted ? '🔇' : '🎤' }}
      </button>
      <p class="text-sm text-gray-400">{{ muted ? 'Micrófono silenciado' : 'Micrófono activo' }}</p>
      <button
        @click="testAudio"
        class="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
      >
        🔊 Test Audio
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useRoomsStore } from '../stores/rooms';
import { io } from 'socket.io-client';
import { usePeerJS } from '../composables/useWebRTC';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const roomsStore = useRoomsStore();

const currentRoom = computed(() => roomsStore.currentRoom);
const messages = computed(() => roomsStore.messages);
const user = computed(() => authStore.user);
const myUserId = computed(() => user.value?.id);

let roomId = null;

const socket = ref(null);
const roomUsers = ref([]);
const speakingUsers = ref(new Set());
const newMessage = ref('');
const chatContainer = ref(null);
const muted = ref(false);
const userVolumes = ref({});

const {
  localStream,
  peers: peerConnections,
  initPeer,
  callPeer,
  onSpeaking,
  setPeerVolume,
  cleanup: webrtcCleanup,
  updateLocalStream,
  getAudioContexts
} = usePeerJS();

let currentStream = null;
let initialized = false;

let currentPeerId = null;

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

const rtcConfig = {
  iceServers,
  iceCandidatePoolSize: 10
};

async function createCall(targetSocketId, username) {
  if (!currentStream) {
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
      console.log('Got user media, tracks:', currentStream.getTracks().map(t => t.kind));
      localStream.value = currentStream;
      updateLocalStream(currentStream);
    } catch (err) {
      console.error('Error getting user media:', err);
      return;
    }
  }
  currentStream.getAudioTracks().forEach(track => {
    track.enabled = !muted.value;
  });

  // With PeerJS, just call the peer
  try {
    await callPeer(targetSocketId);
    console.log('Calling peer:', targetSocketId);
  } catch (err) {
    console.error('Error calling peer:', err);
  }
}

async function answerCall(fromSocketId, offer, username) {
  // With PeerJS, the incoming call is handled automatically by the composable
  // Just ensure we have a local stream ready
  if (!currentStream) {
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
      localStream.value = currentStream;
      updateLocalStream(currentStream);
    } catch (err) {
      console.error('Error getting user media:', err);
      return;
    }
  }
}

function connectToExistingUsers() {
  const otherUsers = roomUsers.value.filter(u => u.userId !== myUserId.value);
  otherUsers.forEach(async (u) => {
    try {
      await createCall(u.socketId, u.username);
    } catch (err) {
      console.error('Error connecting to user:', err);
    }
  });
}

function connectToNewUsers(users) {
  const otherUsers = users.filter(u => u.userId !== myUserId.value);
  const knownSockets = new Set(Object.keys(peerConnections.value));
  otherUsers.forEach(async (u) => {
    if (!knownSockets.has(u.socketId)) {
      try {
        await createCall(u.socketId, u.username);
      } catch (err) {
        console.error('Error connecting to new user:', err);
      }
    }
  });
}

function cleanupPeer(socketId) {
  const peer = peerConnections.value[socketId];
  if (peer) {
    peer.close();
    delete peerConnections.value[socketId];
  }
  speakingUsers.value.delete(socketId);
}

function setVolume(socketId, value) {
  userVolumes.value[socketId] = parseInt(value);
  setPeerVolume(socketId, parseInt(value) / 100);
}

function toggleMute() {
  muted.value = !muted.value;
  if (currentStream) {
    currentStream.getAudioTracks().forEach(track => {
      track.enabled = !muted.value;
    });
  }
}

function testAudio() {
  const contexts = getAudioContexts();
  console.log('Audio contexts:', contexts);
  Object.values(contexts).forEach(ctx => {
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => console.log('AudioContext resumed'));
    }
  });
  alert('Audio test ejecutado - revisá la consola');
}

async function sendMessage() {
  if (!newMessage.value.trim()) return;

  try {
    await roomsStore.sendMessage(roomId, newMessage.value.trim());
    newMessage.value = '';
  } catch (e) {
    alert(e.message);
  }
}

function leaveRoom() {
  if (socket.value) {
    socket.value.emit('leave_room', { roomId });
    socket.value.disconnect();
  }
  webrtcCleanup();
  router.push('/lobby');
}

function formatTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  });
}

onMounted(async () => {
  roomId = parseInt(route.params.id);

  if (isNaN(roomId)) {
    console.error('Invalid room ID');
    router.push('/lobby');
    return;
  }

  try {
    await roomsStore.joinRoom(roomId);
    await roomsStore.fetchMessages(roomId);

    socket.value = io('/', {
      transports: ['websocket', 'polling']
    });

    socket.value.on('connect', async () => {
      socket.value.emit('join_room', {
        roomId: roomId,
        username: user.value.username,
        userId: user.value.id
      });

      if (!initialized) {
        // Use socket ID as PeerJS ID
        currentPeerId = socket.value.id;
        console.log('Initializing PeerJS with ID:', currentPeerId);
        
        // Use default PeerJS public server
        await initPeer(currentPeerId);
        
        initialized = true;
      }

      onSpeaking((socketId, isSpeaking) => {
        if (isSpeaking) {
          speakingUsers.value.add(socketId);
        } else {
          speakingUsers.value.delete(socketId);
        }
      });
    });

    socket.value.on('room_users', (users) => {
      roomUsers.value = users;
      if (initialized) {
        connectToNewUsers(users);
      }
    });

    socket.value.on('user_joined', async ({ username, userId, socketId }) => {
      const existing = roomUsers.value.find(u => u.socketId === socketId);
      if (!existing) {
        roomUsers.value.push({ socketId, username, userId });
      }
      if (myUserId.value !== userId && initialized) {
        await createCall(socketId, username);
      }
    });

    socket.value.on('user_left', ({ socketId }) => {
      roomUsers.value = roomUsers.value.filter(u => u.socketId !== socketId);
      cleanupPeer(socketId);
    });

    // With PeerJS, calls are handled automatically via peer.on('call')
    // No need for voice_offer, voice_answer, ice_candidate handlers

    socket.value.on('new_message', (msg) => {
      roomsStore.addMessage(msg);
      scrollToBottom();
    });

    scrollToBottom();

  } catch (e) {
    console.error(e);
    alert('Error al unirse a la sala');
    router.push('/lobby');
  }
});

onUnmounted(() => {
  if (socket.value) {
    socket.value.emit('leave_room', { roomId });
    socket.value.disconnect();
  }
  webrtcCleanup();
  roomsStore.leaveRoom(roomId);
});

watch(messages.value, () => {
  nextTick(scrollToBottom);
});
</script>