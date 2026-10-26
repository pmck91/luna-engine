//! Procedure scope, argument/property contracts, and graph diagnostics.
use super::*;
impl<'a> Check<'a> {
    pub(super) fn v4(&mut self, subject: &str, field: &str) {
        if self.p.game.format_version < 4 {
            self.error(
                subject,
                field,
                "This feature requires an explicit upgrade to content format 4",
            );
        }
    }
    pub(super) fn reference(
        &mut self,
        subject: &str,
        field: &str,
        reference: &EntityRef,
        expected: Option<InputKind>,
    ) {
        if reference.input().is_some() {
            self.v4(subject, field);
        }
        match self.p.reference_schema(self.procedure, reference) {
            Ok(schema) if expected.is_some_and(|kind| kind != schema.kind) => {
                if let (Some(id), Some(kind)) = (reference.fixed(), expected) {
                    self.error(
                        subject,
                        field,
                        format!("Missing {}: {id}", format!("{kind:?}").to_lowercase()),
                    );
                } else {
                    self.error(
                        subject,
                        field,
                        format!("Expected {:?}, found {:?}", expected.unwrap(), schema.kind),
                    );
                }
            }
            Ok(_) => {}
            Err(error) => {
                if let (Some(id), Some(kind)) = (reference.fixed(), expected) {
                    self.error(
                        subject,
                        field,
                        format!("Missing {}: {id}", format!("{kind:?}").to_lowercase()),
                    );
                } else {
                    self.error(subject, field, error.to_string());
                }
            }
        }
    }
    pub(super) fn property_kind(&self, entity: &EntityRef, name: &str) -> Option<InputKind> {
        self.p
            .reference_schema(self.procedure, entity)
            .ok()?
            .properties
            .get(name)
            .copied()
    }
    pub(super) fn argument_kind(
        &mut self,
        subject: &str,
        field: &str,
        argument: &Argument,
    ) -> Option<InputKind> {
        match self
            .p
            .argument_schema(self.procedure, self.item_input, argument)
        {
            Ok(schema) => Some(schema.kind),
            Err(error) => {
                self.error(subject, field, error.to_string());
                None
            }
        }
    }
    pub(super) fn comparison(
        &mut self,
        subject: &str,
        field: &str,
        left: &Argument,
        op: Comparison,
        right: &Argument,
    ) {
        self.v4(subject, field);
        let left = self.argument_kind(subject, &format!("{field}.left"), left);
        let right = self.argument_kind(subject, &format!("{field}.right"), right);
        if let (Some(left), Some(right)) = (left, right) {
            if left != right || left.is_entity() {
                self.error(
                    subject,
                    field,
                    "Comparison operands require matching scalar types",
                );
            }
            if !matches!(op, Comparison::Eq | Comparison::Ne) && left != InputKind::Integer {
                self.error(
                    subject,
                    field,
                    "Ordered comparisons require Integer operands",
                );
            }
        }
    }
    pub(super) fn assign(
        &mut self,
        subject: &str,
        field: &str,
        target: &ScopedValueTarget,
        value: &Argument,
    ) {
        self.v4(subject, field);
        let target = match target {
            ScopedValueTarget::Variable { name } => {
                self.p.game.variables.get(name).map(InputKind::of)
            }
            ScopedValueTarget::Property { entity, name } => self.property_kind(entity, name),
        };
        let value = self.argument_kind(subject, field, value);
        if target.is_none() || target != value || value.is_some_and(InputKind::is_entity) {
            self.error(
                subject,
                field,
                "Assignment requires an existing target and a matching scalar value",
            );
        }
    }
    pub(super) fn call(
        &mut self,
        subject: &str,
        field: &str,
        id: &str,
        target: &str,
        arguments: &BTreeMap<String, Argument>,
    ) {
        self.v4(subject, field);
        self.id(id, field);
        let Some(procedure) = self
            .p
            .procedures
            .iter()
            .find(|procedure| procedure.id == target)
        else {
            self.error(subject, field, format!("Missing procedure: {target}"));
            return;
        };
        for (id, value) in arguments {
            let Some(input) = procedure.inputs.iter().find(|input| input.id == *id) else {
                self.error(
                    subject,
                    &format!("{field}.arguments.{id}"),
                    "Argument refers to an undeclared input",
                );
                continue;
            };
            match self
                .p
                .argument_schema(self.procedure, self.item_input, value)
            {
                Ok(actual) => {
                    if actual.kind != input.kind {
                        self.error(
                            subject,
                            &format!("{field}.arguments.{id}"),
                            format!("{} requires {:?}", input.name, input.kind),
                        );
                    }
                    for (property, kind) in &input.required_properties {
                        if actual.properties.get(property) != Some(kind) {
                            self.error(subject, &format!("{field}.arguments.{id}"), format!("{} requires {property}: {kind:?}; forwarded inputs must declare that contract", input.name));
                        }
                    }
                }
                Err(error) => self.error(
                    subject,
                    &format!("{field}.arguments.{id}"),
                    error.to_string(),
                ),
            }
        }
        for input in &procedure.inputs {
            if !arguments.contains_key(&input.id) {
                self.error(
                    subject,
                    &format!("{field}.arguments.{}", input.id),
                    format!("Missing argument: {}", input.name),
                );
            }
        }
    }
    pub(super) fn message(&mut self, subject: &str, field: &str, message: &MessageText) {
        match message {
            MessageText::Plain(message) => self.text(subject, field, message),
            MessageText::Bound { text, references } => {
                self.v4(subject, field);
                self.local_message(subject, field, text, references);
            }
        }
    }
    pub(super) fn local_message(
        &mut self,
        subject: &str,
        field: &str,
        message: &str,
        references: &BTreeMap<String, InputTextReference>,
    ) {
        for (key, reference) in references {
            if key.is_empty()
                || key.trim() != key
                || key.contains('%')
                || self.p.text_reference(key).is_some()
            {
                self.error(subject, &format!("{field}.references"), "Message-local names must be nonempty, unambiguous, and must not shadow a variable/property");
            }
            match reference {
                InputTextReference::ItemName if !self.item_input => self.error(
                    subject,
                    field,
                    "Command item name is not available in this flow",
                ),
                InputTextReference::ItemName => {}
                InputTextReference::EntityName { entity } => self.entity(subject, field, entity),
                InputTextReference::ProcedureInput { input } => {
                    self.v4(subject, field);
                    if let Err(error) = self.p.input(self.procedure, input) {
                        self.error(subject, field, error.to_string());
                    }
                }
                InputTextReference::ProcedureProperty { input, name } => {
                    self.v4(subject, field);
                    if self
                        .property_kind(
                            &EntityRef::Input {
                                procedure_input: input.clone(),
                            },
                            name,
                        )
                        .is_none()
                    {
                        self.error(
                            subject,
                            field,
                            "Message property is absent from the procedure input contract",
                        );
                    }
                }
            }
        }
        if let Err(error) = text::format(message, |key| {
            if references.contains_key(key) {
                return Ok("value".into());
            }
            self.p
                .initial_text_value(key)
                .map(ToString::to_string)
                .ok_or_else(|| anyhow::anyhow!("Unknown message value: %{key}%"))
        }) {
            self.error(subject, field, error.to_string());
        }
    }
    pub(super) fn reset_sequences(&self) -> Vec<&Effect> {
        if let Some(procedure) = self.procedure {
            let mut effects = vec![];
            walk_effects(&procedure.effects, &mut effects);
            effects
        } else {
            ordinary_effects(self.p)
        }
    }
    pub(super) fn procedures(&mut self) {
        for procedure in &self.p.procedures {
            self.v4(&procedure.id, "procedure");
            self.id(&procedure.id, "id");
            if procedure.name.trim().is_empty() {
                self.error(&procedure.id, "name", "A procedure name is required");
            }
            let mut ids = BTreeSet::new();
            let mut names = BTreeSet::new();
            for (index, input) in procedure.inputs.iter().enumerate() {
                let field = format!("inputs.{index}");
                if !safe_id(&input.id) || !ids.insert(&input.id) {
                    self.error(
                        &procedure.id,
                        &field,
                        "Input IDs must be safe and unique within the procedure",
                    );
                }
                if input.name.trim().is_empty() || !names.insert(input.name.trim().to_lowercase()) {
                    self.error(
                        &procedure.id,
                        &field,
                        "Input names must be nonempty and unique within the procedure",
                    );
                }
                if !input.kind.is_entity() && !input.required_properties.is_empty() {
                    self.error(
                        &procedure.id,
                        &field,
                        "Only entity inputs can require properties",
                    );
                }
                if input
                    .required_properties
                    .iter()
                    .any(|(name, kind)| name.trim().is_empty() || kind.is_entity())
                {
                    self.error(&procedure.id, &field, "Required properties need a nonempty name and Boolean, Integer, or Text type");
                }
            }
            self.procedure = Some(procedure);
            self.effects(&procedure.id, "effects", &procedure.effects);
            self.procedure = None;
        }
        let definitions = self
            .p
            .procedures
            .iter()
            .map(|procedure| (procedure.id.as_str(), procedure))
            .collect::<BTreeMap<_, _>>();
        let mut done = BTreeSet::new();
        for root in definitions.keys() {
            let mut active = BTreeSet::new();
            let mut stack = vec![(*root, false)];
            while let Some((id, leaving)) = stack.pop() {
                if leaving {
                    active.remove(id);
                    done.insert(id);
                    continue;
                }
                if done.contains(id) {
                    continue;
                }
                if !active.insert(id) {
                    self.error(id, "effects", "Recursive procedure calls are not supported");
                    return;
                }
                stack.push((id, true));
                let mut effects = vec![];
                walk_effects(&definitions[id].effects, &mut effects);
                for effect in effects.into_iter().rev() {
                    if let Effect::Call { procedure, .. } = effect
                        && definitions.contains_key(procedure.as_str())
                    {
                        stack.push((procedure, false));
                    }
                }
            }
        }
    }
}
