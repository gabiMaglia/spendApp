import { useGroupStore } from '../groupStore';
import { useExpenseStore } from '../expenseStore';
import { useGroupKeyStore } from '../groupKeyStore';
import { usePersonalStore } from '../personalStore';
import { useAuthStore } from '../authStore';
import { createSecureStorage } from '@/src/utils/secureStorage';
import { listErrors, clearErrors } from '@/src/services/errorLog';
import type { User } from '@/src/types/models';

/**
 * T-264: un JSON corrupto en hydrate no se pisa con `[]`. El crudo queda en
 * `<clave>.corrupto::u:<uid>` (conserva el sufijo de scope para que el borrado
 * de cuenta lo barra), se anota el error y lo que sí parsea se rescata.
 */
const UID = 'ua';
const bak = (k: string) => `${k}.corrupto::u:${UID}`;

describe('hydrate — respaldo del blob corrupto (T-264)', () => {
  beforeEach(() => {
    useAuthStore.setState({ currentUser: { id: UID } as User, isLoading: false });
    clearErrors();
  });

  it('JSON roto: guarda el crudo aparte, anota el error y arranca vacío', () => {
    const st = createSecureStorage('expenses');
    st.clearAll();
    st.set(`data_v1::u:${UID}`, '{esto no es json');

    useExpenseStore.getState().hydrate();

    expect(useExpenseStore.getState().expenses).toEqual([]);
    expect(st.getString(bak('data_v1'))).toBe('{esto no es json');
    expect(listErrors().length).toBe(1);
  });

  it('un segundo hydrate roto no pisa el primer respaldo', () => {
    const st = createSecureStorage('groups');
    st.clearAll();
    st.set(`data_v1::u:${UID}`, '[{"id":"g1"');
    useGroupStore.getState().hydrate();
    st.set(`data_v1::u:${UID}`, 'otra basura');
    useGroupStore.getState().hydrate();
    expect(st.getString(bak('data_v1'))).toBe('[{"id":"g1"');
  });

  it('registros malformados se descartan de a uno; el resto se conserva', () => {
    const st = createSecureStorage('groupkeys');
    st.clearAll();
    const ok = { groupId: 'g1', version: 1, key: 'k' };
    st.set(`data_v1::u:${UID}`, JSON.stringify([ok, null, 7, 'x']));

    useGroupKeyStore.getState().hydrate();

    expect(useGroupKeyStore.getState().keys).toEqual([ok]);
    expect(st.getString(bak('data_v1'))).toBeDefined();
  });

  it('un blob que es JSON válido pero no un arreglo se trata como corrupto', () => {
    const st = createSecureStorage('personal');
    st.clearAll();
    st.set(`entries_v1::u:${UID}`, '{"a":1}');
    usePersonalStore.getState().hydrate();
    expect(usePersonalStore.getState().entries).toEqual([]);
    expect(st.getString(bak('entries_v1'))).toBe('{"a":1}');
  });

  it('un blob sano no genera respaldo ni error', () => {
    const st = createSecureStorage('groups');
    st.clearAll();
    st.set(`data_v1::u:${UID}`, '[]');
    useGroupStore.getState().hydrate();
    expect(st.getString(bak('data_v1'))).toBeUndefined();
    expect(listErrors()).toEqual([]);
  });
});

describe('respaldo con el scope congelado (T-265)', () => {
  it('no escribe el respaldo de una cuenta que se está borrando', () => {
    const { respaldarCrudo, congelarScope, liberarScope } = jest.requireActual('@/src/store/userScope');
    const { useAuthStore } = jest.requireActual('@/src/store/authStore');
    useAuthStore.setState({ currentUser: { id: 'uc' } });
    const mem = new Map<string, string>();
    const storage = { getString: (k: string) => mem.get(k), set: (k: string, v: string) => { mem.set(k, v); } };
    congelarScope('uc');
    respaldarCrudo(storage, 'expenses', '{roto');
    expect([...mem.keys()]).toEqual([]);
    liberarScope('uc');
    respaldarCrudo(storage, 'expenses', '{roto');
    expect([...mem.keys()]).toHaveLength(1);
  });
});
