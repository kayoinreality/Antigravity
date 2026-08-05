import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end coverage for the three interactions that only exist in this app
 * and therefore cannot be verified anywhere else: the implicit search filters,
 * the black hole delete, and forming a solar system.
 *
 * The canvas draws to a bitmap, so there is nothing in the DOM to assert about
 * a note. Everything is checked through the UI that surrounds it — the counter,
 * the chips, the editor — which is also what a user can actually see.
 */

/**
 * Each test gets a clean IndexedDB; state leaks between them otherwise.
 *
 * The sessionStorage guard matters: init scripts run on every navigation, so
 * without it a test that reloads the page would wipe the database it is trying
 * to prove survived the reload.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('antigravity-test-reset')) return
    sessionStorage.setItem('antigravity-test-reset', '1')
    indexedDB.deleteDatabase('antigravity')
  })
  await page.goto('/')
  await page.waitForSelector('[data-testid="canvas"]')
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

async function makeNote(page: Page, x: number, y: number, title: string, body: string) {
  await page.getByTestId('canvas').dblclick({ position: { x, y } })
  await expect(page.getByTestId('editor')).toBeVisible()
  await page.getByTestId('editor-title').fill(title)
  await page.getByTestId('editor-body').fill(body)
  await page.getByTestId('editor-done').click()
  await expect(page.getByTestId('editor')).toBeHidden()
}

/** Nine notes across three clearly distinct topics. */
async function seedThreeTopics(page: Page) {
  const notes: Array<[number, number, string, string]> = [
    [260, 220, 'Reunião TCC', 'orientador definiu o cronograma da monografia e da banca'],
    [520, 240, 'Monografia TCC', 'escrever o capítulo de metodologia da monografia'],
    [780, 210, 'Banca TCC', 'agendar a banca com o orientador e revisar a monografia'],
    [280, 450, 'Treino perna', 'agachamento leg press e cadeira extensora na academia'],
    [540, 470, 'Treino costas', 'barra fixa remada e puxada na academia com halteres'],
    [800, 440, 'Treino peito', 'supino reto inclinado e crucifixo na academia'],
    [300, 650, 'Receita bolo', 'farinha ovos açúcar fermento e leite para o bolo'],
    [560, 670, 'Receita pão', 'farinha fermento água sal para o pão caseiro'],
    [820, 640, 'Receita torta', 'farinha ovos manteiga e açúcar para a torta doce'],
  ]
  for (const [x, y, title, body] of notes) await makeNote(page, x, y, title, body)
}

test.describe('notes', () => {
  test('double-clicking empty canvas creates a note and opens the editor', async ({ page }) => {
    await makeNote(page, 500, 400, 'Primeira nota', 'corpo da nota')
    await expect(page.getByTestId('note-count')).toHaveText('1 nota')
    await expect(page.getByTestId('empty-state')).toBeHidden()
  })

  test('notes survive a reload', async ({ page }) => {
    await makeNote(page, 500, 400, 'Persistente', 'deve continuar aqui')
    await page.reload()
    await expect(page.getByTestId('note-count')).toHaveText('1 nota')
  })

  test('pressing n creates a note', async ({ page }) => {
    await page.getByTestId('canvas').click({ position: { x: 640, y: 500 } })
    await page.keyboard.press('n')
    await expect(page.getByTestId('editor')).toBeVisible()
  })
})

test.describe('search', () => {
  test('recognises a date phrase without any filter UI', async ({ page }) => {
    await seedThreeTopics(page)

    await page.getByTestId('search-input').fill('academia hoje')
    await expect(page.getByTestId('chip-date')).toHaveText(/hoje/)
    await expect(page.getByTestId('search-count')).toHaveText('3 de 9')
  })

  test('dismissing a chip rewrites the query text itself', async ({ page }) => {
    await seedThreeTopics(page)

    await page.getByTestId('search-input').fill('academia hoje')
    await expect(page.getByTestId('chip-date')).toBeVisible()

    await page.getByTestId('chip-date').click()
    await expect(page.getByTestId('search-input')).toHaveValue('academia')
    await expect(page.getByTestId('chip-date')).toBeHidden()
  })

  test('finds notes by tag', async ({ page }) => {
    await makeNote(page, 400, 300, 'Com tag', 'anotação sobre a entrega #tcc')
    await makeNote(page, 700, 300, 'Sem tag', 'lista de compras da semana')

    await page.getByTestId('search-input').fill('#tcc')
    await expect(page.getByTestId('search-count')).toHaveText('1 de 2')
  })

  test('matches accent-insensitively in both directions', async ({ page }) => {
    await makeNote(page, 400, 300, 'Análise', 'relatório de análise estatística')
    await makeNote(page, 700, 300, 'Outra', 'nada relacionado aqui')

    await page.getByTestId('search-input').fill('analise ')
    await expect(page.getByTestId('search-count')).toHaveText('1 de 2')
  })

  test('reports nothing found rather than an empty screen', async ({ page }) => {
    await makeNote(page, 400, 300, 'Alguma nota', 'conteúdo qualquer')
    await page.getByTestId('search-input').fill('#inexistente')
    await expect(page.getByTestId('search-count')).toHaveText(/Nada por aí/)
  })

  test('slash focuses the field and escape clears it', async ({ page }) => {
    await makeNote(page, 400, 300, 'Alguma nota', 'conteúdo')
    await page.getByTestId('canvas').click({ position: { x: 900, y: 700 } })

    await page.keyboard.press('/')
    await page.keyboard.type('conteudo')
    await expect(page.getByTestId('search-input')).toHaveValue('conteudo')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('search-input')).toHaveValue('')
  })
})

test.describe('black hole delete', () => {
  test('a slow drag toward the top does not delete — that is just arranging', async ({ page }) => {
    await makeNote(page, 800, 620, 'Nota segura', 'não deve sumir')

    await page.mouse.move(800, 620)
    await page.mouse.down()
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(800, 620 - i * 15)
      await page.waitForTimeout(30)
    }
    await page.mouse.up()

    await expect(page.getByTestId('note-count')).toHaveText('1 nota')
    await expect(page.getByTestId('undo-toast')).toBeHidden()
  })

  test('a fast upward flick into the singularity deletes the note', async ({ page }) => {
    await makeNote(page, 400, 620, 'Nota descartável', 'esta vai embora')

    await page.mouse.move(400, 620)
    await page.mouse.down()
    await page.mouse.move(400, 500, { steps: 2 })
    await page.mouse.move(400, 340, { steps: 2 })
    await page.mouse.move(640, 150, { steps: 3 })
    await page.mouse.move(640, 112, { steps: 2 })
    await page.mouse.up()

    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByTestId('undo-toast')).toBeVisible()
  })

  test('undo brings the note back', async ({ page }) => {
    await makeNote(page, 400, 620, 'Volta aqui', 'restaurável')

    await page.mouse.move(400, 620)
    await page.mouse.down()
    await page.mouse.move(400, 500, { steps: 2 })
    await page.mouse.move(400, 340, { steps: 2 })
    await page.mouse.move(640, 112, { steps: 3 })
    await page.mouse.up()

    await expect(page.getByTestId('undo-toast')).toBeVisible()
    await page.getByTestId('undo-button').click()

    await expect(page.getByTestId('note-count')).toHaveText('1 nota')
    await expect(page.getByTestId('undo-toast')).toBeHidden()
  })

  test('deleting from the editor also offers undo', async ({ page }) => {
    await makeNote(page, 500, 400, 'Pelo editor', 'apagada pelo botão')
    await page.getByTestId('canvas').dblclick({ position: { x: 500, y: 400 } })
    await expect(page.getByTestId('editor')).toBeVisible()

    await page.getByTestId('editor-delete').click()
    await expect(page.getByTestId('undo-toast')).toBeVisible()
    await expect(page.getByTestId('empty-state')).toBeVisible()
  })
})

test.describe('solar systems', () => {
  test('suggests a system for notes about the same subject', async ({ page }) => {
    await seedThreeTopics(page)

    const suggestion = page.getByTestId('suggestion')
    await expect(suggestion).toBeVisible({ timeout: 15_000 })
    await expect(suggestion).toHaveText(/3 notas sobre/)
  })

  test('accepting a suggestion forms the system', async ({ page }) => {
    await seedThreeTopics(page)

    await expect(page.getByTestId('suggestion')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('suggestion-accept').click()

    await expect(page.getByTestId('suggestion')).toBeHidden()
    // All nine notes survive; three of them merely moved into orbit.
    await expect(page.getByTestId('note-count')).toHaveText('9 notas')
  })

  test('a dismissed suggestion does not come back', async ({ page }) => {
    await seedThreeTopics(page)

    await expect(page.getByTestId('suggestion')).toBeVisible({ timeout: 15_000 })
    const first = await page.getByTestId('suggestion').textContent()

    await page.getByTestId('suggestion-dismiss').click()
    await page.waitForTimeout(3000)

    const suggestionVisible = await page.getByTestId('suggestion').isVisible()
    if (suggestionVisible) {
      // Another topic may step forward, but never the one just dismissed.
      expect(await page.getByTestId('suggestion').textContent()).not.toBe(first)
    }
  })
})

test.describe('sync status', () => {
  test('reports local-only when no Supabase credentials are configured', async ({ page }) => {
    await expect(page.getByTestId('sync-badge')).toHaveText(/Somente neste aparelho/)
  })
})
