import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import router from '../router';

const API_URL = '/api';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('matechat_token') || '');
  const user = ref(JSON.parse(localStorage.getItem('matechat_user') || 'null'));

  const isAuthenticated = computed(() => !!token.value);

  async function register(username, password) {
    const response = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al registrar');

    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('matechat_token', data.token);
    localStorage.setItem('matechat_user', JSON.stringify(data.user));

    return data;
  }

  async function login(username, password) {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al iniciar sesión');

    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('matechat_token', data.token);
    localStorage.setItem('matechat_user', JSON.stringify(data.user));

    return data;
  }

  function logout() {
    token.value = '';
    user.value = null;
    localStorage.removeItem('matechat_token');
    localStorage.removeItem('matechat_user');
    router.push('/login');
  }

  function getHeaders() {
    return {
      'Authorization': `Bearer ${token.value}`,
      'Content-Type': 'application/json'
    };
  }

  return {
    token,
    user,
    isAuthenticated,
    register,
    login,
    logout,
    getHeaders
  };
});