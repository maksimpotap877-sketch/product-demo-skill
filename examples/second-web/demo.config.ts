import {fileURLToPath} from 'node:url';
import {makeExampleConfig} from '../../dist/discovery.js';
export default makeExampleConfig(fileURLToPath(new URL('../../',import.meta.url)),'second',4174);
