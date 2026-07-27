// Contexto global do app (estado + ações). O AppProvider vive em App.jsx;
// aqui ficam só o contexto e o hook, para qualquer módulo consumir sem ciclo de import.
import { createContext, useContext } from 'react';

export const AppContext = createContext();
export const useApp = () => useContext(AppContext);
