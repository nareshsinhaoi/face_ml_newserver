module.exports = {
  apps: [{
    name: 'modulelabs-attendance',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
      DB_HOST: '193.203.184.152',
      DB_USER: 'u816304761_my_task',
      DB_PASSWORD: 'K*@*YZRVsgsSL3A',
      DB_NAME: 'u816304761_my_task',
      JWT_SECRET: 'modulelabs_secret_2024'
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_file: 'logs/combined.log',
    time: true
  }]
};