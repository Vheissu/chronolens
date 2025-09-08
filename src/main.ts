import Aurelia from 'aurelia';
import { RouterConfiguration } from '@aurelia/router';
import { MyApp } from './my-app';
import { MduiWebTask } from 'aurelia-mdui';
import { AuthHook } from './core/auth-hook';
import { IHttp } from './services/http-client';
import { IAuth } from './services/auth-service';

Aurelia
  .register(
    RouterConfiguration.customize({ useUrlFragmentHash: false }),
    MduiWebTask,
    AuthHook,
    IHttp,
    IAuth,
  )
  .app(MyApp)
  .start();
