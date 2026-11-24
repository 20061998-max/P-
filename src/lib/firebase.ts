import { FirebaseError, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const ADMIN_EMAIL = 'josuelroque05052020@gmail.com';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export function isAuthorizedAdminUser(user: User | null): boolean {
  if (!user || !user.emailVerified || !user.email) return false;
  return user.email.trim().toLowerCase() === ADMIN_EMAIL;
}

export function formatGoogleAuthError(error: unknown): string {
  const code =
    error instanceof FirebaseError
      ? error.code
      : typeof (error as { code?: unknown })?.code === 'string'
        ? ((error as { code: string }).code ?? '')
        : '';
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  switch (code) {
    case 'auth/popup-blocked':
    case 'auth/cancelled-popup-request':
      return 'O navegador bloqueou a janela do Google dentro do preview. Toque em "Abrir em nova aba para Login Google" abaixo ou entre com a Senha Admin.';
    case 'auth/popup-closed-by-user':
      return 'A janela de login do Google foi fechada antes de concluir.';
    case 'auth/unauthorized-domain':
      return `O domínio atual (${host || 'preview'}) precisa estar em Domínios Autorizados no Firebase Console → Authentication.`;
    case 'auth/operation-not-supported-in-this-environment':
      return 'Este ambiente integrado não permite janela popup do Google. Abra o site em uma nova aba para entrar com o Google.';
    case 'auth/network-request-failed':
      return 'Falha de rede ao conectar com o Google. Verifique sua conexão e tente novamente.';
    default:
      return error instanceof Error
        ? error.message
        : 'Não foi possível abrir o login do Google.';
  }
}

export async function signInWithGoogleAccount(): Promise<User> {
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    return credential.user;
  } catch (error) {
    throw new Error(formatGoogleAuthError(error));
  }
}

export async function signOutGoogleAccount(): Promise<void> {
  await signOut(auth);
}
