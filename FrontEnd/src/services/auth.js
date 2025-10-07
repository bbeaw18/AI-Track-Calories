import { api } from './api';

export async function register({ email, password, displayName }) {
  const { data } = await api.post('/auth/register', { email, password, displayName });
  return data; // { user, accessToken }
}

export async function login({ email, password }) {
  const { data } = await api.post('/auth/login', { email, password });
  return data; // { user, accessToken }
}
