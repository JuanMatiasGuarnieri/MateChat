<template>
  <div class="min-h-screen p-4">
    <div class="max-w-2xl mx-auto">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-2xl font-bold text-mate-500">🧉 MateChat</h1>
        <button @click="logout" class="text-gray-400 hover:text-white text-sm">
          Cerrar sesión
        </button>
      </div>

      <div class="bg-gray-800 rounded-xl p-4 mb-6">
        <div class="flex gap-2">
          <input
            v-model="newRoomName"
            type="text"
            placeholder="Nombre de la sala..."
            class="flex-1 px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-mate-500 text-white"
            @keyup.enter="createRoom"
          />
          <button
            @click="createRoom"
            :disabled="!newRoomName.trim() || creating"
            class="bg-mate-600 hover:bg-mate-500 px-4 py-2 rounded-lg font-medium disabled:opacity-50"
          >
            + Crear
          </button>
        </div>
      </div>

      <div class="bg-gray-800 rounded-xl p-4">
        <h2 class="text-lg font-semibold mb-4">Salas disponibles</h2>

        <div v-if="loading" class="text-center py-8 text-gray-400">
          Cargando salas...
        </div>

        <div v-else-if="rooms.length === 0" class="text-center py-8 text-gray-400">
          No hay salas todavía. ¡Crea una!
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="room in rooms"
            :key="room.id"
            class="flex items-center justify-between bg-gray-700 rounded-lg p-4 hover:bg-gray-600 transition-colors"
          >
            <div>
              <h3 class="font-medium">{{ room.name }}</h3>
              <p class="text-sm text-gray-400">{{ room.userCount }} usuario{{ room.userCount !== 1 ? 's' : '' }}</p>
            </div>
            <button
              @click="joinRoom(room.id)"
              class="bg-mate-600 hover:bg-mate-500 px-4 py-2 rounded-lg text-sm font-medium"
            >
              Unirse
            </button>
          </div>
        </div>
      </div>

      <div class="mt-6 text-center text-gray-500 text-sm">
        <p>Usuario: {{ user?.username }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { useRoomsStore } from '../stores/rooms';

const router = useRouter();
const authStore = useAuthStore();
const roomsStore = useRoomsStore();

const user = computed(() => authStore.user);
const rooms = computed(() => roomsStore.rooms);

const newRoomName = ref('');
const loading = ref(true);
const creating = ref(false);

onMounted(async () => {
  try {
    await roomsStore.fetchRooms();
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});

async function createRoom() {
  if (!newRoomName.value.trim()) return;

  creating.value = true;
  try {
    const room = await roomsStore.createRoom(newRoomName.value.trim());
    newRoomName.value = '';
    router.push(`/room/${room.id}`);
  } catch (e) {
    alert(e.message);
  } finally {
    creating.value = false;
  }
}

async function joinRoom(roomId) {
  try {
    await roomsStore.joinRoom(roomId);
    router.push(`/room/${roomId}`);
  } catch (e) {
    alert(e.message);
  }
}

function logout() {
  authStore.logout();
}
</script>