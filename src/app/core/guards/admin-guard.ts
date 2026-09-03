import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';

function hasAdminAccess(role?: string): boolean {
  if (!role) return false;
  const normalized = String(role).toLowerCase().replace(/[^a-z]/g, '');
  return normalized === 'admin' || normalized === 'superadmin';
}

export const adminGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.hasToken()) {
    return router.createUrlTree(['/login']);
  }

  const cachedUser = authService.currentUser$.getValue();
  if (cachedUser && hasAdminAccess(cachedUser.role)) {
    return true;
  }

  return authService.loadCurrentUser().pipe(
    map((res) => {
      if (hasAdminAccess(res?.user.role)) return true;
      return router.createUrlTree(['/play']);
    }),
    catchError(() => {
      const fallbackUser = authService.currentUser$.getValue();
      if (fallbackUser && hasAdminAccess(fallbackUser.role)) return of(true);
      return of(router.createUrlTree(['/login']));
    })
  );
};
