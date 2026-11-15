// Offline caches only this unchanging explanation, never accounts, APIs or files.
const CACHE='zeitplaner-offline-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.add('/offline.html')));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate'&&new URL(event.request.url).pathname==='/')event.respondWith(fetch(event.request).catch(()=>caches.open(CACHE).then(c=>c.match('/offline.html'))));
});

self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const body=typeof data.body==='string'?data.body.slice(0,250):'Bitte öffnen Sie den Zeitplaner und prüfen Sie Ihre Aufträge.';
  event.waitUntil(self.registration.showNotification('IServ Zeitplaner',{body,icon:'/icon.svg',tag:'zeitplaner-status',data:{url:'/'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients)if(new URL(client.url).origin===self.location.origin){await client.focus();return;}
    await self.clients.openWindow('/');
  }));
});
