const { Telegraf } = require('telegraf');
const fetch = require('node-fetch');
const FormData = require('form-data');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);
const sesiones = {};

// Estado de flujo
const ESTADOS = {
  ESPERANDO_TITULO: 'esperando_titulo',
  ESPERANDO_DESCRIPCION: 'esperando_descripcion',
  ESPERANDO_IMAGENES: 'esperando_imagenes',
  EDITANDO_POST: 'editando_post',
  EDITANDO_TITULO: 'editando_titulo',
  EDITANDO_DESCRIPCION: 'editando_descripcion'
};

bot.start((ctx) => {
  const userId = ctx.from.id;
  sesiones[userId] = {
    estado: ESTADOS.ESPERANDO_TITULO,
    titulo: null,
    descripcion: null,
    imagenes: []
  };
  ctx.reply("Konbanwa, Daryl-sama. ¿Cuál será el título del post?");
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const sesion = sesiones[userId];
  if (!sesion) return ctx.reply("Usa /start para iniciar una nueva publicación, Daryl-sama.");

  const texto = ctx.message.text;

  // Si el texto es un link de Telegraph, iniciamos modo edición
  if (texto.startsWith("https://telegra.ph/")) {
    const path = texto.trim().split("/").pop();
    const accessToken = process.env.TELEGRAPH_TOKEN;

    try {
      const res = await fetch(`https://api.telegra.ph/getPage/${path}?return_content=true`);
      const data = await res.json();

      if (!data.ok) throw new Error(data.error);

      sesiones[userId] = {
        estado: ESTADOS.EDITANDO_POST,
        path,
        access_token: accessToken,
        titulo: data.result.title,
        descripcion: data.result.content.find(e => e.tag === 'p')?.children?.[0] || '',
        contenido: data.result.content
      };

      return ctx.reply(`Post cargado, Daryl-sama. Puedes usar /editar_titulo o /editar_descripcion.`);
    } catch (err) {
      console.error(err);
      return ctx.reply("No pude cargar ese post de Telegraph, Daryl-sama.");
    }
  }

  if (texto === '/editar_titulo') {
    if (sesion.estado !== ESTADOS.EDITANDO_POST) return ctx.reply("Primero debes enviar un link de Telegraph.");
    sesion.estado = ESTADOS.EDITANDO_TITULO;
    return ctx.reply("Escribe el nuevo título, Daryl-sama.");
  }

  if (texto === '/editar_descripcion') {
    if (sesion.estado !== ESTADOS.EDITANDO_POST) return ctx.reply("Primero debes enviar un link de Telegraph.");
    sesion.estado = ESTADOS.EDITANDO_DESCRIPCION;
    return ctx.reply("Escribe la nueva descripción, Daryl-sama.");
  }

  if (sesion.estado === ESTADOS.EDITANDO_TITULO) {
    sesion.titulo = texto;
    sesion.estado = ESTADOS.EDITANDO_POST;
    return guardarEdicion(ctx, sesion);
  }

  if (sesion.estado === ESTADOS.EDITANDO_DESCRIPCION) {
    sesion.descripcion = texto;
    sesion.estado = ESTADOS.EDITANDO_POST;
    return guardarEdicion(ctx, sesion);
  }
  if (texto === '/publicar') return publicar(ctx, userId);
  if (texto === '/ver') return verSesion(ctx, userId);
  if (texto === '/cancelar') {
    delete sesiones[userId];
    return ctx.reply("Sesión cancelada, Daryl-sama.");
  }

  if (sesion.estado === ESTADOS.ESPERANDO_TITULO) {
    sesion.titulo = texto;
    sesion.estado = ESTADOS.ESPERANDO_DESCRIPCION;
    return ctx.reply("Título guardado, Daryl-sama. Ahora, si deseas, escribe la descripción. O escribe /saltar para omitirla.");
  }

  if (sesion.estado === ESTADOS.ESPERANDO_DESCRIPCION) {
    if (texto === '/saltar') {
      sesion.descripcion = null;
    } else {
      sesion.descripcion = texto;
    }
    sesion.estado = ESTADOS.ESPERANDO_IMAGENES;
    return ctx.reply("Perfecto, Daryl-sama. Ahora envíame las imágenes.");
  }

  // Si el estado es ESPERANDO_IMAGENES y manda texto, puede estar fuera de contexto
  return ctx.reply("Envía imágenes o escribe /publicar cuando hayas terminado, Daryl-sama.");
});

bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const sesion = sesiones[userId];
  if (!sesion || sesion.estado !== ESTADOS.ESPERANDO_IMAGENES) {
    return ctx.reply("Primero debemos establecer el título y la descripción, Daryl-sama. Usa /start.");
  }

  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);
  sesion.imagenes.push(fileLink.href);
  ctx.reply("Imagen recibida, Daryl-sama.");
});

async function publicar(ctx, userId) {
  const sesion = sesiones[userId];
  if (!sesion || sesion.imagenes.length === 0) {
    return ctx.reply("No hay suficientes datos para publicar, Daryl-sama. Asegúrate de haber enviado imágenes.");
  }

  try {
    const urlsSubidas = await Promise.all(sesion.imagenes.map(uploadToImgbb));

    const content = [];
    if (sesion.descripcion) content.push({ tag: 'p', children: [sesion.descripcion] });
    urlsSubidas.forEach(url => content.push({ tag: 'img', attrs: { src: url } }));

    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: process.env.TELEGRAPH_TOKEN,
        title: sesion.titulo,
        author_name: "Asian My Waifu Cosplay",
        author_url: "https://t.me/asian_my_waifu_cosplay",
        content,
        return_content: false
      })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const postURL = data.result.url;
    const nombreCosplayer = sesion.titulo.split('-')[0].trim();
    const total = sesion.imagenes.length;

    const mensaje = `♀️ [${nombreCosplayer}](${postURL}) ♀️\nÁlbum (${total} Pictures)`;
    ctx.reply(mensaje, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error(err);
    ctx.reply("Hubo un error al publicar en Telegraph, Daryl-sama.");
  }

  delete sesiones[userId];
}

function verSesion(ctx, userId) {
  const sesion = sesiones[userId];
  if (!sesion) return ctx.reply("No hay nada guardado, Daryl-sama.");
  const resumen = `*Título:* ${sesion.titulo || '_No definido_'}\n*Descripción:* ${sesion.descripcion || '_Vacía_'}\n*Imágenes:* ${sesion.imagenes.length}`;
  ctx.reply(resumen, { parse_mode: 'Markdown' });
  sesion.imagenes.forEach((url) => ctx.replyWithPhoto({ url }));
}

async function guardarEdicion(ctx, sesion) {
  // Clonamos contenido original pero reemplazamos la descripción
  const contenido = sesion.contenido.map(c => {
    if (c.tag === 'p') {
      return { tag: 'p', children: [sesion.descripcion] };
    }
    return c;
  });

  try {
    const res = await fetch('https://api.telegra.ph/editPage/' + sesion.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: sesion.access_token,
        title: sesion.titulo,
        content: contenido,
        author_name: "Asian My Waifu Cosplay",
        author_url: "https://t.me/asian_my_waifu_cosplay",
        return_content: false
      })
    });

    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    ctx.reply(`Post actualizado correctamente, Daryl-sama: https://telegra.ph/${sesion.path}`);
  } catch (err) {
    console.error(err);
    ctx.reply("No pude guardar los cambios, Daryl-sama.");
  }
}
async function uploadToImgbb(imageUrl) {
  const form = new FormData();
  form.append('image', imageUrl);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (!data.success) throw new Error("Fallo al subir imagen a imgbb.");
  return data.data.url;
}

bot.launch();
console.log("Bot iniciado...");