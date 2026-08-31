const fs = require('fs');

function watchProject(projectRoot, onChange) {
  const timers = new Map();

  const watcher = fs.watch(
    projectRoot,
    {
      recursive: true,
    },
    (eventType, filename) => {
      if (!filename) {
        return;
      }

      const file = filename.replace(/\\/g, '/');

      if (
        file.includes('node_modules/') ||
        file.includes('.git/')
      ) {
        return;
      }

      const previousTimer = timers.get(file);

      if(previousTimer) {
        clearTimeout(previousTimer);
      }

      const timer = setTimeout(() => {
        timers.delete(file);
        onChange({
          eventType,
          file,
        });
      }, 150);

      timers.set(file, timer)
    }
  );

  watcher.on('error', (error) => {
    console.error(
      'Watcher error:',
      error.message
    );
  });

  return watcher;
}

module.exports = {
  watchProject,
};