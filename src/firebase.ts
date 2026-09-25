/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signOut, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  User 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  collection, 
  setDoc, 
  addDoc, 
  getDocFromServer, 
  serverTimestamp, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  updateDoc
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// CRITICAL: Connect directly to the specific provisioned Firestore database
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Standard Firestore Error Handling conforming to FirestoreErrorInfo
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

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((p) => ({
        providerId: p.providerId,
        email: p.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Security / Operation Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection on boot
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase connection: client appears offline, check network.');
    }
  }
}
testConnection();

// Interface for inquiries submitted through the contact terminal
export interface InquiryData {
  name: string;
  email: string;
  phone?: string;
  service: string;
  message: string;
  source?: string;
}

export async function submitInquiryToFirestore(data: InquiryData): Promise<string> {
  const path = 'inquiries';
  const docId = `inq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  try {
    const docRef = doc(db, path, docId);
    await setDoc(docRef, {
      name: data.name.trim().substring(0, 100),
      email: data.email.trim().toLowerCase().substring(0, 120),
      phone: (data.phone || '').trim().substring(0, 30),
      service: data.service.substring(0, 60),
      message: data.message.trim().substring(0, 2000),
      source: data.source || 'portfolio_terminal',
      status: 'new',
      createdAt: serverTimestamp(),
    });
    return docId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `${path}/${docId}`);
  }
}

// Interface for Chat Sessions
export interface ChatSessionData {
  sessionId: string;
  userId?: string;
  userEmail?: string;
  clientName?: string;
  lastMessage?: string;
  messageCount?: number;
}

export async function ensureChatSessionDoc(sessionId: string): Promise<void> {
  const sessionRef = doc(db, 'chat_sessions', sessionId);
  try {
    const snap = await getDocFromServer(sessionRef);
    if (!snap.exists()) {
      await setDoc(sessionRef, {
        sessionId,
        userId: auth.currentUser ? auth.currentUser.uid : 'anon_client',
        userEmail: auth.currentUser?.email || '',
        clientName: auth.currentUser?.displayName || 'Prospective Client',
        lastMessage: 'Session started',
        messageCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // If checking failed or document didn't exist yet, attempt creation
    try {
      await setDoc(sessionRef, {
        sessionId,
        userId: auth.currentUser ? auth.currentUser.uid : 'anon_client',
        userEmail: auth.currentUser?.email || '',
        clientName: auth.currentUser?.displayName || 'Prospective Client',
        lastMessage: 'Session started',
        messageCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('Chat session doc already initialized or pending write:', e);
    }
  }
}

export async function createOrUpdateChatSession(session: ChatSessionData): Promise<void> {
  const path = `chat_sessions/${session.sessionId}`;
  const sessionRef = doc(db, 'chat_sessions', session.sessionId);
  try {
    let exists = false;
    try {
      const snap = await getDocFromServer(sessionRef);
      exists = snap.exists();
    } catch {
      exists = false;
    }

    if (!exists) {
      await setDoc(sessionRef, {
        sessionId: session.sessionId,
        userId: session.userId || (auth.currentUser ? auth.currentUser.uid : 'anon_client'),
        userEmail: session.userEmail || (auth.currentUser?.email || ''),
        clientName: session.clientName || (auth.currentUser?.displayName || 'Prospective Client'),
        lastMessage: (session.lastMessage || '').substring(0, 1000),
        messageCount: session.messageCount ?? 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const updateData: Record<string, any> = {
        updatedAt: serverTimestamp(),
      };
      if (session.userId !== undefined) updateData.userId = session.userId;
      if (session.userEmail !== undefined) updateData.userEmail = session.userEmail;
      if (session.clientName !== undefined) updateData.clientName = session.clientName;
      if (session.lastMessage !== undefined) updateData.lastMessage = session.lastMessage.substring(0, 1000);
      if (session.messageCount !== undefined) updateData.messageCount = session.messageCount;
      await updateDoc(sessionRef, updateData);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function appendChatMessage(
  sessionId: string, 
  sender: 'user' | 'assistant', 
  text: string
): Promise<string> {
  const path = `chat_sessions/${sessionId}/messages`;
  try {
    // 1. Ensure the parent session document exists in Firestore first
    await ensureChatSessionDoc(sessionId);

    // 2. Add message to the subcollection
    const messagesCol = collection(db, 'chat_sessions', sessionId, 'messages');
    const newMsg = await addDoc(messagesCol, {
      sender,
      text: text.substring(0, 3000),
      timestamp: serverTimestamp(),
    });

    // 3. Update parent session updatedAt and lastMessage
    const sessionRef = doc(db, 'chat_sessions', sessionId);
    await updateDoc(sessionRef, {
      lastMessage: text.substring(0, 300),
      updatedAt: serverTimestamp(),
    }).catch((err) => {
      console.warn('Could not update parent session lastMessage:', err);
    });

    return newMsg.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeToSessionMessages(
  sessionId: string, 
  onMessages: (msgs: Array<{ id: string; sender: 'user' | 'assistant'; text: string; timestamp?: any }>) => void
) {
  const path = `chat_sessions/${sessionId}/messages`;
  try {
    const messagesCol = collection(db, 'chat_sessions', sessionId, 'messages');
    const q = query(messagesCol, orderBy('timestamp', 'asc'), limit(50));
    return onSnapshot(
      q,
      (snapshot) => {
        const msgs = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as { sender: 'user' | 'assistant'; text: string; timestamp?: any }),
        }));
        onMessages(msgs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// Google Auth Handlers
export async function loginWithGoogle(): Promise<User | null> {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    return cred.user;
  } catch (err) {
    console.error('Google Sign In failed:', err);
    throw err;
  }
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export function onAuthStatusChange(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}
