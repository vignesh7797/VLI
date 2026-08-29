const fs = require('fs');

function watchProject(projectRoot, onChange) {
  let timer;

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

      if (file.includes('node_modules/') || file.includes('.git/')) {
        return;
      }

      clearTimeout(timer);

      timer = setTimeout(() => {
        onChange({
          eventType,
          file,
        });
      }, 100);
    }
  );

  watcher.on('error', (error) => {
    console.error('Watcher error:', error.message);
  });

  return watcher;
}

module.exports = {
  watchProject,
};
