import { Elysia, t } from 'elysia'
import __Dirname from 'tiny-dirname'
import * as path from 'path'

const __dirname = __Dirname(import.meta.url)

type ReleaseInfo = {
	current: boolean
	key: string,
	index: string,
	files: string,
	releasedAt: number,
}

const gameRoot = process.env.NODE_ENV === 'development' ? path.join(__dirname, '../test/papa-cherry-2') : path.join(__dirname, '../../../')

const app = new Elysia()

app.get('/', (ctx) => ctx.set.redirect = '/list')

app.get('/game', (ctx) => gameRoot)

app.get('/list', (ctx) => {
	return [{
		current: true,
		key: 'master-11',
		index: 'index_master-11.html',
		files: 'files_master-11.json',
		releasedAt: Date.now(),
	}, {
		current: false,
		key: 'master-10',
		index: 'index_master-10.html',
		files: 'files_master-10.json',
		releasedAt: Date.now() - 10_000,
	}] as ReleaseInfo[]
})

app.get('/current', (ctx) => {
	console.log(__dirname)
	
	return {
		current: true,
		key: 'master-11',
		index: 'index_master-11.html',
		files: 'files_master-11.json',
		releasedAt: Date.now(),
	}
})

app.post('/publish', (ctx) => ctx.query, {
	query: t.Object({
		platform: t.String({ format: 'uri' }),
		env: t.Optional(t.String()),
	}),
})

app.post('/rollback', (ctx) => ctx.body, {
	body: t.Object({
		platform: t.String({ format: 'uri' }),
		build: t.Optional(t.String({ pattern: '(\w+)-(\d+)' })),
	}),
})

app.listen(3000)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)

export default app
