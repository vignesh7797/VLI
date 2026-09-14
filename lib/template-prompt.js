const readline = require('readline');

function askTemplate() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('');
        console.log('Select a template:');
        console.log('');
        console.log('1. Vanilla');
        console.log('2. Vormir');
        console.log('');

        rl.question('Template [1]: ', (answer) => {
            rl.close();

            const value = answer.trim() || '1';

            if(value === '' || value === '1') {
                resolve('vanilla');

                return;
            }

            if(value === '2') {
                resolve('vormir');

                return;
            }

            if(value.toLowerCase() === 'vanilla') {
                resolve('vanilla');

                return;
            }

            if(value.toLowerCase() === 'vormir') {
                resolve('vormir');

                return;
            }

            console.warn('[VLI] Invalid template. Using vanilla.');

            resolve('vanilla');
        })
    });
}

module.exports = {
    askTemplate
};