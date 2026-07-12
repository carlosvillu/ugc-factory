// Serialización de una fila `persona` al contrato PÚBLICO (`PersonaSchema` de @ugc/core).
//
// En UN solo sitio porque la comparten CUATRO rutas (list, create, get/patch, candidatas) y el
// drift entre ellas sería invisible: cada una devolvería una forma ligeramente distinta y el
// frontend validaría contra el mismo schema… hasta que una dejara de cuadrar.
//
// Las dos traducciones que hace: `Date` → ISO (JSON no tiene fechas) y `jsonb` opaco → el shape
// validado (`voiceMap`). El `parse` NO es decorativo: si la BD tuviera un voice_map con forma
// inválida (escrito antes de que existiera el contrato, o a mano), esto revienta con un 500
// explícito en vez de servir basura al navegador — que es lo correcto (es drift NUESTRO).
import { PersonaSchema, type Persona } from '@ugc/core/persona';
import type { PersonaRow } from '@ugc/db';

// SOLO se nombran las DOS traducciones reales (las fechas). Los demás campos NO se enumeran a
// mano: hacerlo convertía este fichero en un punto de drift silencioso —añadir una columna al
// contrato y olvidarse de añadir su línea aquí la borraba de la API sin que nada fallara—, y
// T2.2/T2.4 van a tocar el contrato. El `parse` de Zod ya es el whitelist: descarta las claves
// que el schema no declara (hoy `perf`, la única columna extra de la fila).
export function toPersonaResponse(row: PersonaRow): Persona {
  return PersonaSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
