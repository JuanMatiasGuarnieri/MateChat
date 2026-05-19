import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const routes = [
  {
    path: '/',
    redirect: '/login'
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue')
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/RegisterView.vue')
  },
  {
    path: '/lobby',
    name: 'Lobby',
    component: () => import('../views/LobbyView.vue'),
    meta: { requiresAuth: true }
  },
  {
    path: '/room/:id',
    name: 'Room',
    component: () => import('../views/SalaVozView.vue'),
    meta: { requiresAuth: true }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next('/login');
  } else if ((to.path === '/login' || to.path === '/register') && authStore.isAuthenticated) {
    next('/lobby');
  } else {
    next();
  }
});

export default router;