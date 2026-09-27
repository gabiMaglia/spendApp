import { onCaptchaInteractiveChange, setCaptchaInteractive } from '../captchaBridge';

/**
 * T-147 (fix "no se pudo confirmar tu acceso"): `relaySession` necesita
 * saber cuándo el captcha está en modo interactivo (espera humana, sin
 * tope) para pausar su propio tope de red mientras tanto. `CaptchaHost` es
 * quien avisa; esto prueba el puente en sí, sin React.
 */
describe('captchaBridge: aviso de interactivo', () => {
  it('notifica a cada suscriptor con el valor que se anuncia', () => {
    const recibidos: boolean[] = [];
    const off = onCaptchaInteractiveChange(activo => recibidos.push(activo));
    setCaptchaInteractive(true);
    setCaptchaInteractive(false);
    expect(recibidos).toEqual([true, false]);
    off();
  });

  it('desuscribirse deja de notificar', () => {
    const recibidos: boolean[] = [];
    const off = onCaptchaInteractiveChange(activo => recibidos.push(activo));
    off();
    setCaptchaInteractive(true);
    expect(recibidos).toEqual([]);
  });

  it('varios suscriptores reciben el mismo aviso, sin pisarse', () => {
    const a: boolean[] = [];
    const b: boolean[] = [];
    const offA = onCaptchaInteractiveChange(v => a.push(v));
    const offB = onCaptchaInteractiveChange(v => b.push(v));
    setCaptchaInteractive(true);
    expect(a).toEqual([true]);
    expect(b).toEqual([true]);
    offA();
    offB();
  });
});
