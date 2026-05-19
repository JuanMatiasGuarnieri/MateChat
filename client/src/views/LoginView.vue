<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold text-mate-500 mb-2">🧉 MateChat</h1>
        <p class="text-gray-400">Conecta con tus amigos</p>
      </div>

      <form @submit.prevent="handleLogin" class="bg-gray-800 rounded-xl p-6 shadow-lg">
        <h2 class="text-xl font-semibold mb-6 text-center">Iniciar Sesión</h2>

        <div v-if="error" class="bg-red-500/20 text-red-400 p-3 rounded-lg mb-4 text-sm">
          {{ error }}
        </div>

        <div class="mb-4">
          <label class="block text-sm text-gray-400 mb-2">Usuario</label>
          <input
            v-model="username"
            type="text"
            required
            class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-mate-500 text-white"
            placeholder="Tu usuario"
          />
        </div>

        <div class="mb-6">
          <label class="block text-sm text-gray-400 mb-2">Contraseña</label>
          <input
            v-model="password"
            type="password"
            required
            class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-mate-500 text-white"
            placeholder="Tu contraseña"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full bg-mate-600 hover:bg-mate-500 text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-50"
        >
          {{ loading ? 'Entrando...' : 'Entrar' }}
        </button>

        <p class="mt-4 text-center text-gray-400 text-sm">
          ¿No tienes cuenta?
          <router-link to="/register" class="text-mate-500 hover:text-mate-400">
            Regístrate
          </router-link>
        </p>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function handleLogin() {
  error.value = '';
  loading.value = true;

  try {
    await authStore.login(username.value, password.value);
    router.push('/lobby');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>