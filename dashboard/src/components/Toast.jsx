import { createContext, useContext, useState, useCallback, useRef } from "react";

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [state, setState] = useState({ msg: "", err: false, show: false });
  const timer = useRef(null);

  const toast = useCallback((msg, isErr) => {
    setState({ msg, err: !!isErr, show: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setState((s) => ({ ...s, show: false }));
    }, 2600);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={"toast" + (state.show ? " show" : "") + (state.err ? " err" : "")}>
        {state.msg}
      </div>
    </ToastContext.Provider>
  );
}
