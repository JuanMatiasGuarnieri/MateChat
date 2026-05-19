import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useAuthStore } from './auth';

const API_URL = '/api';

export const useRoomsStore = defineStore('rooms', () => {
  const rooms = ref([]);
  const currentRoom = ref(null);
  const messages = ref([]);

  async function fetchRooms() {
    const authStore = useAuthStore();
    const response = await fetch(`${API_URL}/rooms`, {
      headers: authStore.getHeaders()
    });

    if (!response.ok) throw new Error('Error al obtener salas');
    rooms.value = await response.json();
    return rooms.value;
  }

  async function createRoom(name) {
    const authStore = useAuthStore();
    const response = await fetch(`${API_URL}/rooms`, {
      method: 'POST',
      headers: authStore.getHeaders(),
      body: JSON.stringify({ name })
    });

    if (!response.ok) throw new Error('Error al crear sala');
    const room = await response.json();
    rooms.value.unshift(room);
    return room;
  }

  async function joinRoom(roomId) {
    const authStore = useAuthStore();
    const response = await fetch(`${API_URL}/rooms/${roomId}/join`, {
      method: 'POST',
      headers: authStore.getHeaders()
    });

    if (!response.ok) throw new Error('Error al unirse a la sala');
    currentRoom.value = await response.json();
    return currentRoom.value;
  }

  async function leaveRoom(roomId) {
    const authStore = useAuthStore();
    const response = await fetch(`${API_URL}/rooms/${roomId}/leave`, {
      method: 'POST',
      headers: authStore.getHeaders()
    });

    if (!response.ok) throw new Error('Error al salir de la sala');
    currentRoom.value = null;
    messages.value = [];
  }

  async function fetchMessages(roomId) {
    const authStore = useAuthStore();
    const response = await fetch(`${API_URL}/rooms/${roomId}/messages`, {
      headers: authStore.getHeaders()
    });

    if (!response.ok) throw new Error('Error al obtener mensajes');
    messages.value = await response.json();
    return messages.value;
  }

  async function sendMessage(roomId, content) {
    const authStore = useAuthStore();
    const response = await fetch(`${API_URL}/rooms/${roomId}/messages`, {
      method: 'POST',
      headers: authStore.getHeaders(),
      body: JSON.stringify({ content })
    });

    if (!response.ok) throw new Error('Error al enviar mensaje');
    const message = await response.json();
    messages.value.push(message);
    return message;
  }

  function addMessage(message) {
    messages.value.push(message);
  }

  return {
    rooms,
    currentRoom,
    messages,
    fetchRooms,
    createRoom,
    joinRoom,
    leaveRoom,
    fetchMessages,
    sendMessage,
    addMessage
  };
});