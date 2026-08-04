export default function Home() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-16 sm:px-6 lg:px-8"
    >
      <section aria-labelledby="page-title" className="max-w-3xl">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-brand-700">
          Limpio, Paraguay
        </p>
        <h1
          id="page-title"
          className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl"
        >
          Entrená con propósito.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
          La base accesible y responsive de Gym ADR está lista para incorporar el
          contenido público del gimnasio en las próximas tareas.
        </p>
      </section>
    </main>
  );
}
