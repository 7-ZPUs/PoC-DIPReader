import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';

import { DatabaseService } from './database.service';
import { TantivyService } from './tantivy.service';
import { SEARCH_ENGINE } from './search-engine.interface';

const useSqlite = true;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    {
      provide: SEARCH_ENGINE, 
      useClass: useSqlite ? DatabaseService : TantivyService
    }
  ]
};
