import {momentum, momentumView, accountStates, accountClient} from '../background/service-worker.js';
import {registerMomentumTesting} from './momentum-background.js';
registerMomentumTesting({momentum, momentumView, accountStates, accountClient});
