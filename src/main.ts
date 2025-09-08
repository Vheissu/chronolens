import Aurelia from 'aurelia';
import { RouterConfiguration } from '@aurelia/router';
import { MyApp } from './my-app';
import { MduiWebTask } from 'aurelia-mdui';

Aurelia
  .register(RouterConfiguration.customize({ useUrlFragmentHash: false }), MduiWebTask)
  .app(MyApp)
  .start();
