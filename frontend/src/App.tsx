import { QueryClientProvider } from "@tanstack/react-query";
import { Provider as JotaiProvider } from "jotai";
import { RouterProvider } from "react-router-dom";

import { appQueryClient } from "./lib/query/queryClient";
import { router } from "./routes/router";

function App() {
  return (
    <JotaiProvider>
      <QueryClientProvider client={appQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </JotaiProvider>
  );
}

export default App;
