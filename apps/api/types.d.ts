import type { UserRole } from "common";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        email: string;
        role: UserRole;
      };
      nodeAuth?: {
        id: string;
        region: string;
        apiKey: string;
      };
    }
  }
}

export {};
