export default {
  kajiApi: {
    input: {
      target: "./openapi.yaml",
    },
    output: {
      target: "../frontend/src/lib/api/generated/client.ts",
      client: "fetch",
      mode: "single",
      prettier: false,
      override: {
        mutator: {
          path: "../frontend/src/lib/api/client.ts",
          name: "customFetch",
        },
      },
    },
  },
};
