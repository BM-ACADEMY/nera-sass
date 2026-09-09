module.exports = {
  apps: [
    {
      name: 'leados-api',
      script: 'server.js',
      cwd: '/opt/leados/backend/server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3600,
      },
      error_file: '/opt/leados/logs/error.log',
      out_file: '/opt/leados/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
