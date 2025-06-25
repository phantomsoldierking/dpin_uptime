import axios from "axios";
import { API_BACKEND_URL } from "@/config";
import { clearSession, getAccessToken } from "@/lib/auth";

export const api = axios.create({
  baseURL: API_BACKEND_URL,
  timeout: 15_000,
});

api.interceptors.request.use((request) => {
  const token = getAccessToken();
  if (token) {
    request.headers.Authorization = `Bearer ${token}`;
  }
  return request;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearSession();
    }
    return Promise.reject(error);
  },
);
