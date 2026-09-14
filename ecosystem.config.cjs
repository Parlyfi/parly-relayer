module.exports = {
  apps: [
    {
      name: "parly-relayer",
      script: "pnpm",
      args: "start"
    },
    {
      name: "parly-relayer-reconciler",
      script: "pnpm",
      args: "reconcile:pending:loop"
    }
  ]
}
