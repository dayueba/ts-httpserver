import axios from 'axios';

async function main() {
  const { data: res1 } = await axios.post(
    'http://127.0.0.1:1234/echo',
    'hello'
  );
  console.assert(res1 === 'hello');

  const { data: res2 } = await axios.post('http://127.0.0.1:1234/foo');
  console.assert(res2 === 'hello world.');
}

main().then(() => process.exit(0));
