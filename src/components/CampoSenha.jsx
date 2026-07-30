import React, { useState, useId } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { forcaSenha, MIN_SENHA } from '../../api/_shared/senha.js';

// Campo de senha com o olhinho de mostrar/ocultar.
//
// Existia em três telas com implementações diferentes e faltava em outras cinco
// — inclusive no cadastro, que é onde errar a senha custa mais caro: a pessoa
// digita errado duas vezes, cria a conta com uma senha que não sabe qual é, e
// perde o acesso ao bolão.
//
// `medidor` liga a barrinha de força. Ela orienta, não bloqueia: quem bloqueia
// é validaSenha, no envio, e o mesmo módulo roda no servidor.

export function CampoSenha({
  valor, onChange, rotulo = 'Senha', placeholder = '••••••••',
  medidor = false, autoComplete = 'current-password', onEnter, id,
  className = 'v2-input', dica = '',
}) {
  const [visivel, setVisivel] = useState(false);
  const gerado = useId();
  const campoId = id || `senha-${gerado}`;
  const forca = medidor ? forcaSenha(valor) : null;

  const cores = ['#ef6461', '#ef6461', '#f9a825', '#34d375', '#10b957'];

  return (
    <div>
      {rotulo && <label htmlFor={campoId} className="v2-label">{rotulo}</label>}
      <div className="relative">
        <input
          id={campoId}
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`${className} pr-11`}
        />
        <button
          type="button"
          onClick={() => setVisivel(v => !v)}
          // aria-label muda junto com o ícone: leitor de tela precisa saber o
          // que o botão FAZ agora, não o estado em que a senha está.
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visivel}
          tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
        >
          {visivel ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>

      {medidor && valor && (
        <div className="mt-2">
          <div className="flex gap-1 mb-1">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-1 flex-1 rounded-full transition-colors"
                style={{ background: i < forca.nivel ? cores[forca.nivel] : 'rgba(128,128,128,0.22)' }} />
            ))}
          </div>
          <p className="text-xs" style={{ color: cores[forca.nivel] }}>{forca.rotulo}</p>
        </div>
      )}

      {dica && !valor && <p className="text-xs text-gray-400 mt-1">{dica}</p>}
      {medidor && !valor && !dica && (
        <p className="text-xs text-gray-400 mt-1">Pelo menos {MIN_SENHA} caracteres, com letras e números.</p>
      )}
    </div>
  );
}

export default CampoSenha;
