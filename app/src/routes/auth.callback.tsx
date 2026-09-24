import { createFileRoute } from "@tanstack/react-router";
import { AuthCallbackPage } from "../features/auth/routes/AuthCallbackPage";
export const Route = createFileRoute("/auth/callback")({ component: AuthCallbackPage });
