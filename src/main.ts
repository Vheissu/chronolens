import Aurelia from 'aurelia';
import { RouterConfiguration } from '@aurelia/router';
import { MyApp } from './my-app';
import { MduiWebTask } from 'aurelia-mdui';
// MDUI library (bundled, no CDN):
import 'mdui/mdui.css';
import 'mdui';
import { IHttp } from './services/http-client';
import { IAuth } from './services/auth-service';

Aurelia
  .register(
    RouterConfiguration.customize({ useUrlFragmentHash: false }),
    MduiWebTask,
    IHttp,
    IAuth,
  )
  .app(MyApp)
  .start();
