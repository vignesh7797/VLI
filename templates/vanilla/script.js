console.log('VLI script loaded');

const hot = import.meta.vli.hot;

const countElement = document.querySelector('#count');

const incrementButton = document.querySelector('#incrementButton');

let count = hot?.data.count ?? 0;

function render() {
  if (countElement) {
    countElement.textContent = count;
  }
}

function handleIncrement() {
  count++;
  render();
}

incrementButton?.addEventListener('click', handleIncrement);

render();

if (hot) {
  hot.accept();

  hot.dispose((data) => {
    data.count = count;
    incrementButton?.removeEventListener('click', handleIncrement);
  });
}
